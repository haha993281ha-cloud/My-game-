import express from 'express';
import type { Request, Response } from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import type {
  ClientWsMessage,
  MultiplayerPlayerLobby,
  RemoteRacerSnapshot,
  RoomStatePayload,
  RoomSummary,
  ServerWsMessage,
} from './src/game/multiplayerTypes';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ServerPlayer extends MultiplayerPlayerLobby {
  ws: WebSocket;
  snapshot: RemoteRacerSnapshot | null;
}

interface ServerRoom {
  code: string;
  trackId: string;
  hostId: string;
  status: 'lobby' | 'racing';
  fillWithAi: boolean;
  players: Map<string, ServerPlayer>;
  createdAt: number;
}

const PORT = 3000;
const MAX_PLAYERS_PER_ROOM = 6;
const rooms = new Map<string, ServerRoom>();
const clientRoomMap = new Map<string, string>();
let nextClientSeq = 1;

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return rooms.has(code) ? generateRoomCode() : code;
}

function sendMsg(ws: WebSocket, msg: ServerWsMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function toRoomPayload(room: ServerRoom): RoomStatePayload {
  const players: MultiplayerPlayerLobby[] = Array.from(room.players.values())
    .sort((a, b) => a.slotIndex - b.slotIndex)
    .map((p) => ({
      id: p.id,
      name: p.name,
      carId: p.carId,
      slotIndex: p.slotIndex,
      isHost: p.id === room.hostId,
      connected: p.ws.readyState === WebSocket.OPEN,
    }));

  return {
    code: room.code,
    trackId: room.trackId,
    hostId: room.hostId,
    status: room.status,
    fillWithAi: room.fillWithAi,
    players,
  };
}

function broadcastToRoom(room: ServerRoom, msg: ServerWsMessage, excludeId?: string): void {
  const raw = JSON.stringify(msg);
  for (const player of room.players.values()) {
    if (excludeId && player.id === excludeId) continue;
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(raw);
    }
  }
}

function assignSlotIndex(room: ServerRoom): number {
  const taken = new Set(Array.from(room.players.values()).map((p) => p.slotIndex));
  for (let i = 0; i < MAX_PLAYERS_PER_ROOM; i++) {
    if (!taken.has(i)) return i;
  }
  return room.players.size;
}

function removePlayerFromRoom(clientId: string): void {
  const code = clientRoomMap.get(clientId);
  if (!code) return;
  clientRoomMap.delete(clientId);

  const room = rooms.get(code);
  if (!room) return;

  room.players.delete(clientId);

  if (room.players.size === 0) {
    rooms.delete(code);
    return;
  }

  // Reassign host if host left
  if (room.hostId === clientId) {
    const nextHost = Array.from(room.players.values()).sort((a, b) => a.slotIndex - b.slotIndex)[0];
    if (nextHost) {
      room.hostId = nextHost.id;
      nextHost.isHost = true;
    }
  }

  broadcastToRoom(room, { type: 'room:state', room: toRoomPayload(room) });
}

function sanitizeName(raw: string): string {
  const cleaned = String(raw || '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .slice(0, 16);
  return cleaned || 'Driver';
}

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json());

  app.get('/api/rooms', (_req: Request, res: Response) => {
    const list: RoomSummary[] = [];
    for (const room of rooms.values()) {
      const host = room.players.get(room.hostId);
      list.push({
        code: room.code,
        trackId: room.trackId,
        hostName: host?.name ?? 'Host',
        playerCount: room.players.size,
        maxPlayers: MAX_PLAYERS_PER_ROOM,
        status: room.status,
      });
    }
    res.json({ rooms: list });
  });

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true, activeRooms: rooms.size });
  });

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws: WebSocket) => {
    const clientId = `p_${nextClientSeq++}_${Math.random().toString(36).slice(2, 6)}`;
    sendMsg(ws, { type: 'connected', clientId });

    ws.on('message', (data: Buffer) => {
      let msg: ClientWsMessage;
      try {
        msg = JSON.parse(data.toString()) as ClientWsMessage;
      } catch {
        return;
      }

      switch (msg.type) {
        case 'room:create': {
          removePlayerFromRoom(clientId);
          const code = generateRoomCode();
          const player: ServerPlayer = {
            id: clientId,
            name: sanitizeName(msg.name),
            carId: msg.carId || 'apex-gtr',
            slotIndex: 0,
            isHost: true,
            connected: true,
            ws,
            snapshot: null,
          };
          const room: ServerRoom = {
            code,
            trackId: msg.trackId || 'sunset-canyon',
            hostId: clientId,
            status: 'lobby',
            fillWithAi: true,
            players: new Map([[clientId, player]]),
            createdAt: Date.now(),
          };
          rooms.set(code, room);
          clientRoomMap.set(clientId, code);
          sendMsg(ws, { type: 'room:joined', room: toRoomPayload(room), selfId: clientId });
          break;
        }

        case 'room:join': {
          const code = String(msg.code || '').trim().toUpperCase();
          const room = rooms.get(code);
          if (!room) {
            sendMsg(ws, { type: 'room:error', message: `Room ${code || ''} not found.` });
            return;
          }
          if (room.players.size >= MAX_PLAYERS_PER_ROOM) {
            sendMsg(ws, { type: 'room:error', message: 'Room is full (6/6 racers).' });
            return;
          }
          if (room.status === 'racing') {
            sendMsg(ws, { type: 'room:error', message: 'Race already in progress.' });
            return;
          }

          if (room.players.has(clientId)) {
            sendMsg(ws, { type: 'room:joined', room: toRoomPayload(room), selfId: clientId });
            return;
          }

          removePlayerFromRoom(clientId);
          const slotIndex = assignSlotIndex(room);
          const player: ServerPlayer = {
            id: clientId,
            name: sanitizeName(msg.name),
            carId: msg.carId || 'apex-gtr',
            slotIndex,
            isHost: false,
            connected: true,
            ws,
            snapshot: null,
          };
          room.players.set(clientId, player);
          clientRoomMap.set(clientId, code);

          const payload = toRoomPayload(room);
          sendMsg(ws, { type: 'room:joined', room: payload, selfId: clientId });
          broadcastToRoom(room, { type: 'room:state', room: payload }, clientId);
          break;
        }

        case 'room:leave': {
          removePlayerFromRoom(clientId);
          sendMsg(ws, { type: 'room:left' });
          break;
        }

        case 'room:update_car': {
          const code = clientRoomMap.get(clientId);
          if (!code) return;
          const room = rooms.get(code);
          const player = room?.players.get(clientId);
          if (!room || !player) return;
          player.carId = msg.carId;
          broadcastToRoom(room, { type: 'room:state', room: toRoomPayload(room) });
          break;
        }

        case 'room:update_track': {
          const code = clientRoomMap.get(clientId);
          if (!code) return;
          const room = rooms.get(code);
          if (!room || room.hostId !== clientId || room.status !== 'lobby') return;
          room.trackId = msg.trackId;
          broadcastToRoom(room, { type: 'room:state', room: toRoomPayload(room) });
          break;
        }

        case 'room:toggle_ai': {
          const code = clientRoomMap.get(clientId);
          if (!code) return;
          const room = rooms.get(code);
          if (!room || room.hostId !== clientId || room.status !== 'lobby') return;
          room.fillWithAi = Boolean(msg.fillWithAi);
          broadcastToRoom(room, { type: 'room:state', room: toRoomPayload(room) });
          break;
        }

        case 'room:start': {
          const code = clientRoomMap.get(clientId);
          if (!code) return;
          const room = rooms.get(code);
          if (!room || room.hostId !== clientId) return;
          room.status = 'racing';
          for (const p of room.players.values()) {
            p.snapshot = null;
          }
          broadcastToRoom(room, {
            type: 'race:start',
            room: toRoomPayload(room),
            startAtServerMs: Date.now(),
          });
          break;
        }

        case 'room:return_lobby': {
          const code = clientRoomMap.get(clientId);
          if (!code) return;
          const room = rooms.get(code);
          if (!room || room.hostId !== clientId) return;
          room.status = 'lobby';
          for (const p of room.players.values()) {
            p.snapshot = null;
          }
          broadcastToRoom(room, { type: 'room:state', room: toRoomPayload(room) });
          break;
        }

        case 'player:state': {
          const code = clientRoomMap.get(clientId);
          if (!code) return;
          const room = rooms.get(code);
          const player = room?.players.get(clientId);
          if (!room || !player || room.status !== 'racing') return;
          player.snapshot = {
            ...msg.snapshot,
            id: player.id,
            name: player.name,
            carId: player.carId,
          };
          break;
        }
      }
    });

    ws.on('close', () => {
      removePlayerFromRoom(clientId);
    });
  });

  // Authoritative 25Hz state broadcast loop for active racing rooms
  setInterval(() => {
    for (const room of rooms.values()) {
      if (room.status !== 'racing') continue;
      const snapshots: RemoteRacerSnapshot[] = [];
      for (const player of room.players.values()) {
        if (player.snapshot) {
          snapshots.push(player.snapshot);
        }
      }
      if (snapshots.length > 0) {
        broadcastToRoom(room, { type: 'race:snapshots', snapshots });
      }
    }
  }, 40);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req: Request, res: Response) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`SAHANUR RACING server listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
