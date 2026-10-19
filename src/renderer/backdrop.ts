import { CanvasTexture, SRGBColorSpace } from 'three';
import type { Backdrop, ScenePalette } from '../themes';

/** A tiny static sky texture keeps the native view and PNG exports consistent. */
export function createBackdrop(palette: ScenePalette): CanvasTexture {
  // Decorated skies need more pixels; they are cropped, not stretched.
  const size = palette.backdrop ? 1024 : 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Backdrop canvas unavailable');
  context.scale(size / 512, size / 512);
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
  if (palette.backdrop) decorations[palette.backdrop](context, palette);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Deterministic noise so the sky (and every export) is identical each time. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Painter = (
  context: CanvasRenderingContext2D,
  palette: ScenePalette,
) => void;

const decorations: Record<Backdrop, Painter> = {
  /** Retro-future sunset: striped sun, neon horizon, starfield. */
  synthwave(context, palette) {
    const random = seeded(2077);
    for (let i = 0; i < 140; i++) {
      context.fillStyle = `rgba(255,255,255,${0.15 + random() * 0.6})`;
      const r = random() * 1.1 + 0.2;
      context.fillRect(random() * 512, random() * 300, r, r);
    }
    const cx = 256,
      cy = 300,
      radius = 118;
    const halo = context.createRadialGradient(
      cx,
      cy,
      radius * 0.6,
      cx,
      cy,
      radius * 2.2,
    );
    halo.addColorStop(0, `${palette.flow}88`);
    halo.addColorStop(1, `${palette.flow}00`);
    context.fillStyle = halo;
    context.fillRect(0, 0, 512, 512);
    context.save();
    context.beginPath();
    context.arc(cx, cy, radius, 0, Math.PI * 2);
    context.clip();
    const sun = context.createLinearGradient(0, cy - radius, 0, cy + radius);
    sun.addColorStop(0, palette.selected);
    sun.addColorStop(0.55, palette.flow);
    sun.addColorStop(1, '#7a0bc0');
    context.fillStyle = sun;
    context.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    // Venetian-blind cuts that thicken toward the horizon.
    context.globalCompositeOperation = 'destination-out';
    for (let i = 0, y = cy + 8; y < cy + radius; i++) {
      const gap = 2 + i * 1.6;
      context.fillRect(cx - radius, y, radius * 2, gap);
      y += gap + 9 - i * 0.6;
    }
    context.restore();
    const horizon = context.createLinearGradient(0, 0, 512, 0);
    horizon.addColorStop(0, `${palette.edge}00`);
    horizon.addColorStop(0.5, palette.edge);
    horizon.addColorStop(1, `${palette.edge}00`);
    context.fillStyle = horizon;
    context.shadowColor = palette.edge;
    context.shadowBlur = 18;
    context.fillRect(0, cy + radius - 6, 512, 2.5);
    context.shadowBlur = 0;
    // Neon mountain ridge sitting on the horizon.
    context.strokeStyle = `${palette.flow}cc`;
    context.lineWidth = 1.4;
    context.beginPath();
    let y = cy + radius - 6;
    context.moveTo(0, y);
    for (let x = 0; x <= 512; x += 16) {
      const ridge = Math.abs(x - cx) < radius + 10 ? 0 : 10 + random() * 46;
      y = cy + radius - 6 - ridge;
      context.lineTo(x, y);
    }
    context.stroke();
  },
  /** Falling glyph columns frozen mid-cascade. */
  matrix(context, palette) {
    const random = seeded(1999);
    const glyphs = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉ01011010<>{}[]#$%&*+=';
    context.font = '11px "DejaVu Sans Mono", ui-monospace, monospace';
    context.textAlign = 'center';
    for (let x = 6; x < 512; x += 12) {
      if (random() < 0.25) continue;
      const head = random() * 600 - 80;
      const length = 8 + Math.floor(random() * 22);
      for (let i = 0; i < length; i++) {
        const y = head - i * 13;
        if (y < -10 || y > 520) continue;
        const fade = 1 - i / length;
        context.fillStyle =
          i === 0
            ? `rgba(220,255,230,${0.55})`
            : `${palette.edge}${alpha(fade * 0.38)}`;
        context.fillText(
          glyphs[Math.floor(random() * glyphs.length)] ?? '0',
          x,
          y,
        );
      }
    }
    // CRT vignette.
    const vignette = context.createRadialGradient(256, 256, 120, 256, 256, 380);
    vignette.addColorStop(0, '#00000000');
    vignette.addColorStop(1, '#000000cc');
    context.fillStyle = vignette;
    context.fillRect(0, 0, 512, 512);
  },
  /** A blazing corona, flare rays and a pair of curling ram horns. */
  solar(context, palette) {
    const random = seeded(3141);
    const cx = 256,
      cy = 190;
    context.save();
    context.translate(cx, cy);
    for (let i = 0; i < 64; i++) {
      const angle = (i / 64) * Math.PI * 2 + random() * 0.04;
      const length = (i % 2 ? 150 : 250) + random() * 70;
      context.rotate(angle);
      const ray = context.createLinearGradient(0, 0, length, 0);
      ray.addColorStop(0, `${palette.edge}55`);
      ray.addColorStop(1, `${palette.edge}00`);
      context.fillStyle = ray;
      context.beginPath();
      context.moveTo(40, -3);
      context.lineTo(length, 0);
      context.lineTo(40, 3);
      context.fill();
      context.rotate(-angle);
    }
    context.restore();
    const corona = context.createRadialGradient(cx, cy, 0, cx, cy, 120);
    corona.addColorStop(0, '#fffbe6');
    corona.addColorStop(0.25, palette.selected);
    corona.addColorStop(0.5, `${palette.edgeSelected}cc`);
    corona.addColorStop(1, `${palette.edgeSelected}00`);
    context.fillStyle = corona;
    context.beginPath();
    context.arc(cx, cy, 120, 0, Math.PI * 2);
    context.fill();
    // Ram horns: mirrored logarithmic spirals sprouting from the corona.
    for (const side of [-1, 1]) {
      context.beginPath();
      for (let t = 0; t <= 1; t += 0.01) {
        const angle = -Math.PI / 2 + t * Math.PI * 2.4;
        const r = 46 * Math.exp(-1.2 * t);
        const x = cx + side * (52 + Math.cos(angle) * r);
        const y = cy - 50 + Math.sin(angle) * r;
        if (t === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.strokeStyle = `${palette.edge}66`;
      context.lineWidth = 6;
      context.lineCap = 'round';
      context.shadowColor = palette.edgeSelected;
      context.shadowBlur = 24;
      context.stroke();
      context.strokeStyle = `${palette.selected}88`;
      context.lineWidth = 1.5;
      context.stroke();
    }
    context.shadowBlur = 0;
    for (let i = 0; i < 90; i++) {
      context.fillStyle = `${random() < 0.5 ? palette.edge : palette.edgeSelected}${alpha(0.2 + random() * 0.6)}`;
      context.beginPath();
      context.arc(
        random() * 512,
        250 + random() * 262,
        random() * 1.6 + 0.3,
        0,
        Math.PI * 2,
      );
      context.fill();
    }
  },
  /** Ink ensō, misty mountains, raked sand and a vermilion seal. */
  zen(context, palette) {
    const random = seeded(108);
    for (const [layer, height, tone] of [
      [0, 250, '#a9a392'],
      [1, 285, '#c3bca8'],
      [2, 318, '#d9d1bd'],
    ] as const) {
      context.fillStyle = `${tone}${layer ? 'cc' : 'aa'}`;
      context.beginPath();
      context.moveTo(0, 512);
      let y: number = height;
      for (let x = 0; x <= 512; x += 8) {
        y += (random() - 0.5) * 14 + Math.sin(x / (60 + layer * 20)) * 3;
        y = Math.max(height - 70, Math.min(height + 40, y));
        context.lineTo(x, y);
      }
      context.lineTo(512, 512);
      context.fill();
    }
    // Raked sand: concentric ripples around a stone.
    context.strokeStyle = '#ffffff99';
    context.lineWidth = 1;
    for (let r = 14; r < 320; r += 9) {
      context.beginPath();
      context.ellipse(390, 440, r * 1.6, r * 0.45, 0, 0, Math.PI * 2);
      context.stroke();
    }
    context.fillStyle = '#6e695c';
    context.beginPath();
    context.ellipse(390, 436, 24, 10, -0.1, 0, Math.PI * 2);
    context.fill();
    // Ensō: one tapering brush stroke that leaves its gap.
    const cx = 256,
      cy = 165,
      radius = 62;
    const start = -Math.PI * 0.35;
    const sweep = Math.PI * 1.8;
    context.lineCap = 'round';
    for (let i = 0; i < 160; i++) {
      const t0 = i / 160,
        t1 = (i + 1) / 160;
      context.strokeStyle = `rgba(43,42,38,${0.6 - t0 * 0.3})`;
      context.lineWidth = 9 * Math.sin(Math.PI * Math.min(1, t0 * 1.08)) + 1;
      context.beginPath();
      context.arc(cx, cy, radius, start + t0 * sweep, start + t1 * sweep);
      context.stroke();
    }
    // Dry-brush streaks along the stroke.
    context.lineWidth = 0.6;
    for (let i = 0; i < 6; i++) {
      context.strokeStyle = `rgba(43,42,38,${0.15 + random() * 0.2})`;
      context.beginPath();
      context.arc(
        cx,
        cy,
        radius + (random() - 0.5) * 8,
        start + 0.2,
        start + sweep * (0.6 + random() * 0.35),
      );
      context.stroke();
    }
    // Hanko seal in the corner.
    context.fillStyle = palette.edgeSelected;
    context.fillRect(452, 34, 30, 30);
    context.strokeStyle = palette.sky[0];
    context.lineWidth = 2.5;
    context.strokeRect(457, 39, 20, 20);
    context.beginPath();
    context.moveTo(467, 41);
    context.lineTo(467, 57);
    context.moveTo(459, 49);
    context.lineTo(475, 49);
    context.stroke();
  },
  /** Comic-book halftone and speed lines. */
  halftone(context) {
    for (let y = 0; y <= 512; y += 10)
      for (let x = (y / 10) % 2 ? 5 : 0; x <= 512; x += 10) {
        const corner = Math.hypot(x - 256, y - 256) / 362;
        const r = Math.max(0, (corner - 0.35) * 7.5);
        if (r < 0.25) continue;
        context.fillStyle = '#000000';
        context.beginPath();
        context.arc(x, y, r, 0, Math.PI * 2);
        context.fill();
      }
    const random = seeded(1);
    context.strokeStyle = '#00000033';
    for (let i = 0; i < 70; i++) {
      const angle = random() * Math.PI * 2;
      const inner = 210 + random() * 60;
      context.lineWidth = random() * 1.8 + 0.4;
      context.beginPath();
      context.moveTo(
        256 + Math.cos(angle) * inner,
        256 + Math.sin(angle) * inner,
      );
      context.lineTo(256 + Math.cos(angle) * 420, 256 + Math.sin(angle) * 420);
      context.stroke();
    }
  },
};

/** Two-digit hex alpha for appending to a #rrggbb colour. */
function alpha(value: number): string {
  return Math.round(Math.max(0, Math.min(1, value)) * 255)
    .toString(16)
    .padStart(2, '0');
}
