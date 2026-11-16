import * as THREE from 'three';

export function createAsphaltTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // Base dark asphalt
  ctx.fillStyle = '#252830';
  ctx.fillRect(0, 0, 512, 512);

  // Subtle aggregate grain
  for (let i = 0; i < 16000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const v = 28 + Math.floor(Math.random() * 26);
    ctx.fillStyle = `rgb(${v},${v + 2},${v + 5})`;
    ctx.fillRect(x, y, 2, 2);
  }

  // Subtle racing groove tire wear
  const groove = ctx.createLinearGradient(0, 0, 512, 0);
  groove.addColorStop(0, 'rgba(15,17,22,0)');
  groove.addColorStop(0.28, 'rgba(14,16,20,0.32)');
  groove.addColorStop(0.5, 'rgba(20,22,28,0.08)');
  groove.addColorStop(0.72, 'rgba(14,16,20,0.32)');
  groove.addColorStop(1, 'rgba(15,17,22,0)');
  ctx.fillStyle = groove;
  ctx.fillRect(0, 0, 512, 512);

  // Crisp white outer edge lines
  ctx.fillStyle = '#E2E8F0';
  ctx.fillRect(14, 0, 10, 512);
  ctx.fillRect(488, 0, 10, 512);

  // Dashed center line
  ctx.fillStyle = 'rgba(241, 245, 249, 0.72)';
  for (let y = 16; y < 512; y += 64) {
    ctx.fillRect(253, y, 6, 32);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

export function createCurbTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  const stripeH = 64;
  for (let y = 0; y < 256; y += stripeH) {
    ctx.fillStyle = (y / stripeH) % 2 === 0 ? '#DC2626' : '#F8FAFC';
    ctx.fillRect(0, y, 128, stripeH);
  }

  // Slight weathering
  ctx.fillStyle = 'rgba(15, 23, 42, 0.14)';
  for (let i = 0; i < 600; i++) {
    ctx.fillRect(Math.random() * 128, Math.random() * 256, 2, 2);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

export function createCheckeredTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  const cols = 16;
  const rows = 4;
  const cw = canvas.width / cols;
  const ch = canvas.height / rows;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? '#F8FAFC' : '#0F172A';
      ctx.fillRect(c * cw, r * ch, cw, ch);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

export function createBannerTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 192;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#0F172A';
  ctx.fillRect(0, 0, 1024, 192);

  // Racing red accent stripe along bottom & top
  ctx.fillStyle = '#EF4444';
  ctx.fillRect(0, 0, 1024, 14);
  ctx.fillRect(0, 178, 1024, 14);

  // Checkered edge blocks
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 4; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? '#F8FAFC' : '#1E293B';
      ctx.fillRect(24 + c * 22, 26 + r * 23, 22, 23);
      ctx.fillRect(1024 - 112 + c * 22, 26 + r * 23, 22, 23);
    }
  }

  ctx.fillStyle = '#F8FAFC';
  ctx.font = '700 62px "Chakra Petch", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('SAHANUR RACING', 512, 96);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

export function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createRadialGradient(128, 128, 16, 128, 128, 122);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.85)');
  grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.45)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createSkyDomeTexture(topHex: string, bottomHex: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, topHex);
  grad.addColorStop(0.48, topHex);
  grad.addColorStop(0.82, bottomHex);
  grad.addColorStop(1, bottomHex);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 32, 512);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
