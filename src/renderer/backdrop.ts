import { CanvasTexture, SRGBColorSpace } from 'three';

/** A tiny static sky texture keeps the native view and PNG exports consistent. */
export function createBackdrop(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Backdrop canvas unavailable');
  const base = context.createLinearGradient(0, 0, 0, 512);
  base.addColorStop(0, '#0a101a');
  base.addColorStop(0.55, '#102432');
  base.addColorStop(1, '#0c1b25');
  context.fillStyle = base;
  context.fillRect(0, 0, 512, 512);
  const glow = context.createRadialGradient(245, 110, 0, 245, 110, 330);
  glow.addColorStop(0, '#294057');
  glow.addColorStop(1, '#14283800');
  context.fillStyle = glow;
  context.fillRect(0, 0, 512, 512);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
