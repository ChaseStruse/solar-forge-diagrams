import {
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  RingGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  type Vector3,
} from 'three';
import type { ScenePalette } from '../themes';

/** What the player needs from the board; the scene implements it. */
export interface JourneyHost {
  add(object: Object3D): void;
  remove(object: Object3D): void;
  animate(step: (time: number) => boolean): () => void;
  /** World polyline of a connection, already at travel height. */
  route(edgeId: string): Vector3[] | undefined;
  /** Top centre and footprint radius of a node. */
  node(id: string): { point: Vector3; radius: number } | undefined;
  outgoing(nodeId: string): readonly string[];
  target(edgeId: string): string | undefined;
  onHop(edgeId: string): void;
  onFinish(): void;
}
interface Traveler {
  edge: string;
  points: Vector3[];
  lengths: number[];
  total: number;
  distance: number;
  sprite: Sprite;
  trail: Sprite[];
}
const SPEED = 320;
const DWELL = 380;
const PULSE = 750;
const REST = 1300;
const TRAIL = 6;

/**
 * A person walks every arrow leaving the start, splits at forks, pauses at
 * each service with a ripple, and loops until stopped. Each connection is
 * walked once per lap, so cycles end.
 */
export class JourneyPlayer {
  private readonly avatar: CanvasTexture;
  private readonly glow: CanvasTexture;
  private readonly ring = new RingGeometry(0.86, 1, 64);
  private travelers: Traveler[] = [];
  private dwells: { node: string; until: number }[] = [];
  private pulses: { mesh: Mesh; born: number; radius: number }[] = [];
  private walked = new Set<string>();
  private starts: readonly string[] = [];
  private stopAnimation: (() => void) | undefined;
  private last = 0;
  private restAt = 0;

  constructor(
    private readonly host: JourneyHost,
    private readonly palette: ScenePalette,
  ) {
    this.avatar = personTexture(palette.flow);
    this.glow = glowTexture(palette.flow);
  }
  public get playing(): boolean {
    return this.stopAnimation !== undefined;
  }
  public start(starts: readonly string[]): void {
    this.stop(false);
    this.starts = starts;
    this.lap(performance.now());
    this.last = performance.now();
    this.stopAnimation = this.host.animate((time) => this.step(time));
  }
  public stop(notify = true): void {
    const wasPlaying = this.playing;
    this.stopAnimation?.();
    this.stopAnimation = undefined;
    for (const traveler of this.travelers) this.removeTraveler(traveler);
    for (const pulse of this.pulses) this.removePulse(pulse.mesh);
    this.travelers = [];
    this.pulses = [];
    this.dwells = [];
    if (notify && wasPlaying) this.host.onFinish();
  }
  public dispose(): void {
    this.stop(false);
    this.avatar.dispose();
    this.glow.dispose();
    this.ring.dispose();
  }
  private lap(time: number): void {
    this.walked.clear();
    this.restAt = 0;
    for (const id of this.starts) {
      this.pulse(id, time);
      this.dwells.push({ node: id, until: time + DWELL });
    }
  }
  private step(time: number): boolean {
    const dt = Math.min(0.05, (time - this.last) / 1000);
    this.last = time;
    for (const traveler of [...this.travelers]) {
      traveler.distance += SPEED * dt;
      if (traveler.distance >= traveler.total) {
        this.removeTraveler(traveler);
        this.travelers.splice(this.travelers.indexOf(traveler), 1);
        const target = this.host.target(traveler.edge);
        if (target) {
          this.pulse(target, time);
          this.dwells.push({ node: target, until: time + DWELL });
        }
        continue;
      }
      this.place(traveler);
    }
    for (const dwell of [...this.dwells]) {
      if (time < dwell.until) continue;
      this.dwells.splice(this.dwells.indexOf(dwell), 1);
      for (const edge of this.host.outgoing(dwell.node)) {
        if (this.walked.has(edge)) continue;
        this.walked.add(edge);
        this.depart(edge);
      }
    }
    for (const pulse of [...this.pulses]) {
      const age = (time - pulse.born) / PULSE;
      if (age >= 1) {
        this.removePulse(pulse.mesh);
        this.pulses.splice(this.pulses.indexOf(pulse), 1);
        continue;
      }
      const eased = 1 - (1 - age) ** 3;
      pulse.mesh.scale.setScalar(pulse.radius * (0.9 + eased * 0.6));
      const material = pulse.mesh.material;
      if (material instanceof MeshBasicMaterial) material.opacity = 1 - age;
    }
    if (!this.travelers.length && !this.dwells.length) {
      // Lap finished: rest a moment, then walk again.
      if (!this.restAt) this.restAt = time + REST;
      else if (time >= this.restAt) this.lap(time);
    }
    return true;
  }
  private depart(edge: string): void {
    const points = this.host.route(edge);
    if (!points || points.length < 2) return;
    const lengths = [0];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i];
      lengths.push((lengths[i - 1] ?? 0) + (a && b ? a.distanceTo(b) : 0));
    }
    const sprite = new Sprite(
      new SpriteMaterial({
        map: this.avatar,
        depthTest: false,
        transparent: true,
      }),
    );
    sprite.renderOrder = 20;
    sprite.scale.setScalar(78);
    const trail = Array.from({ length: TRAIL }, (_, i) => {
      const dot = new Sprite(
        new SpriteMaterial({
          map: this.glow,
          depthTest: false,
          transparent: true,
          opacity: 0.55 * (1 - i / TRAIL),
        }),
      );
      dot.renderOrder = 19;
      dot.scale.setScalar(34 * (1 - i / (TRAIL * 1.4)));
      this.host.add(dot);
      return dot;
    });
    this.host.add(sprite);
    const traveler: Traveler = {
      edge,
      points,
      lengths,
      total: lengths[lengths.length - 1] ?? 0,
      distance: 0,
      sprite,
      trail,
    };
    this.travelers.push(traveler);
    this.place(traveler);
    this.host.onHop(edge);
  }
  private pointAt(traveler: Traveler, distance: number, out: Vector3): Vector3 {
    const d = Math.max(0, Math.min(traveler.total, distance));
    let i = 1;
    while (i < traveler.lengths.length - 1 && (traveler.lengths[i] ?? 0) < d)
      i++;
    const a = traveler.points[i - 1],
      b = traveler.points[i];
    const from = traveler.lengths[i - 1] ?? 0;
    const span = (traveler.lengths[i] ?? from) - from;
    if (!a || !b) return out;
    return out.copy(a).lerp(b, span > 0 ? (d - from) / span : 0);
  }
  private place(traveler: Traveler): void {
    this.pointAt(traveler, traveler.distance, traveler.sprite.position);
    traveler.sprite.position.y += 34;
    traveler.trail.forEach((dot, i) => {
      this.pointAt(traveler, traveler.distance - (i + 1) * 13, dot.position);
      dot.position.y += 4;
    });
  }
  private pulse(nodeId: string, time: number): void {
    const node = this.host.node(nodeId);
    if (!node) return;
    const mesh = new Mesh(
      this.ring,
      new MeshBasicMaterial({
        color: this.palette.flow,
        transparent: true,
        depthTest: false,
      }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(node.point);
    mesh.renderOrder = 18;
    this.host.add(mesh);
    this.pulses.push({ mesh, born: time, radius: node.radius });
  }
  private removeTraveler(traveler: Traveler): void {
    for (const sprite of [traveler.sprite, ...traveler.trail]) {
      this.host.remove(sprite);
      sprite.material.dispose();
    }
  }
  private removePulse(mesh: Mesh): void {
    this.host.remove(mesh);
    if (mesh.material instanceof MeshBasicMaterial) mesh.material.dispose();
  }
}

function personTexture(color: string): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) throw Error('Journey canvas unavailable');
  const halo = context.createRadialGradient(64, 64, 10, 64, 64, 64);
  halo.addColorStop(0, `${color}cc`);
  halo.addColorStop(0.55, `${color}55`);
  halo.addColorStop(1, `${color}00`);
  context.fillStyle = halo;
  context.fillRect(0, 0, 128, 128);
  context.fillStyle = color;
  context.beginPath();
  context.arc(64, 64, 30, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#ffffff';
  context.beginPath();
  context.arc(64, 52, 9, 0, Math.PI * 2);
  context.fill();
  context.beginPath();
  context.moveTo(45, 82);
  context.quadraticCurveTo(46, 64, 64, 64);
  context.quadraticCurveTo(82, 64, 83, 82);
  context.closePath();
  context.fill();
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
function glowTexture(color: string): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (!context) throw Error('Journey canvas unavailable');
  const glow = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  glow.addColorStop(0, `${color}ff`);
  glow.addColorStop(1, `${color}00`);
  context.fillStyle = glow;
  context.fillRect(0, 0, 64, 64);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
