import { CanvasTexture, SRGBColorSpace } from 'three';
import type { ScenePalette } from '../themes';

/** A tiny static sky texture keeps the native view and PNG exports consistent. */
export function createBackdrop(palette: ScenePalette): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Backdrop canvas unavailable');
  const [top, middle, bottom] = palette.sky;
  const base = context.createLinearGradient(0, 0, 0, 512);
  base.addColorStop(0, top);
  base.addColorStop(0.55, middle);
  base.addColorStop(1, bottom);
  context.fillStyle = base;
  context.fillRect(0, 0, 512, 512);
  const glow = context.createRadialGradient(245, 110, 0, 245, 110, 330);
  glow.addColorStop(0, palette.glow);
  glow.addColorStop(1, `${middle}00`);
  context.fillStyle = glow;
  context.fillRect(0, 0, 512, 512);
  if (palette.stars) drawStars(context);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** A seeded starfield, identical on every load and in every export. */
function drawStars(context: CanvasRenderingContext2D): void {
  let seed = 0x5eed;
  const random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < 260; i++) {
    const bright = random() < 0.08;
    context.globalAlpha = bright ? 0.95 : 0.25 + random() * 0.5;
    context.fillStyle = random() < 0.2 ? '#c9d6ff' : '#ffffff';
    context.beginPath();
    context.arc(
      random() * 512,
      random() * 512,
      bright ? 0.7 : 0.25 + random() * 0.3,
      0,
      Math.PI * 2,
    );
    context.fill();
  }
  context.globalAlpha = 1;
}
