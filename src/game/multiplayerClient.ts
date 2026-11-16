import type {
  ClientWsMessage,
  RemoteRacerSnapshot,
  RoomStatePayload,
  RoomSummary,
  ServerWsMessage,
} from './multiplayerTypes';

export interface MultiplayerClientHandlers {
  onConnectionChange: (connected: boolean) => void;
  onRoomJoined: (room: RoomStatePayload, selfId: string) => void;
  onRoomState: (room: RoomStatePayload) => void;
  onRoomLeft: () => void;
  onRoomError: (message: string) => void;
  onRaceStart: (room: RoomStatePayload) => void;
  onSnapshots: (snapshots: RemoteRacerSnapshot[]) => void;
}

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private handlers: MultiplayerClientHandlers;
  private reconnectTimer: number | null = null;
  private intentionallyClosed = false;
  private lastSendTime = 0;

  constructor(handlers: MultiplayerClientHandlers) {
    this.handlers = handlers;
  }

  public connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.intentionallyClosed = false;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/ws`;

    try {
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onopen = () => {
        this.handlers.onConnectionChange(true);
      };

      ws.onmessage = (evt) => {
        let msg: ServerWsMessage;
        try {
          msg = JSON.parse(String(evt.data)) as ServerWsMessage;
        } catch {
          return;
        }

        switch (msg.type) {
          case 'room:joined':
            this.handlers.onRoomJoined(msg.room, msg.selfId);
            break;
          case 'room:state':
            this.handlers.onRoomState(msg.room);
            break;
          case 'room:left':
            this.handlers.onRoomLeft();
            break;
          case 'room:error':
            this.handlers.onRoomError(msg.message);
            break;
          case 'race:start':
            this.handlers.onRaceStart(msg.room);
            break;
          case 'race:snapshots':
            this.handlers.onSnapshots(msg.snapshots);
            break;
        }
      };

      ws.onclose = () => {
        this.handlers.onConnectionChange(false);
        this.ws = null;
        if (!this.intentionallyClosed) {
          this.reconnectTimer = window.setTimeout(() => this.connect(), 2000);
        }
      };

      ws.onerror = () => {
        // onclose handles reconnection
      };
    } catch {
      this.handlers.onConnectionChange(false);
    }
  }

  public send(msg: ClientWsMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  public sendPlayerSnapshot(snapshot: Omit<RemoteRacerSnapshot, 'id' | 'name' | 'carId'>): void {
    const now = performance.now();
    if (now - this.lastSendTime < 42) return; // ~24Hz throttle
    this.lastSendTime = now;
    this.send({ type: 'player:state', snapshot });
  }

  public async fetchOpenRooms(): Promise<RoomSummary[]> {
    try {
      const res = await fetch('/api/rooms');
      if (!res.ok) return [];
      const data = (await res.json()) as { rooms?: RoomSummary[] };
      return data.rooms ?? [];
    } catch {
      return [];
    }
  }

  public disconnect(): void {
    this.intentionallyClosed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }
}
