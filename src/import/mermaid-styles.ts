/**
 * Mermaid styling for imports: `classDef`, `class`, `:::name` and `style`
 * lines resolve to one board colour per node. The board has a single tint
 * per component, so a fill wins over a stroke; other properties are dropped.
 */

/** CSS colour keywords most often used in Mermaid charts. */
const NAMED: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  orange: '#ffa500',
  purple: '#800080',
  pink: '#ffc0cb',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  navy: '#000080',
  teal: '#008080',
  maroon: '#800000',
  olive: '#808000',
  lime: '#00ff00',
  aqua: '#00ffff',
  cyan: '#00ffff',
  fuchsia: '#ff00ff',
  magenta: '#ff00ff',
  gold: '#ffd700',
  coral: '#ff7f50',
  salmon: '#fa8072',
  tomato: '#ff6347',
  crimson: '#dc143c',
  indigo: '#4b0082',
  violet: '#ee82ee',
  orchid: '#da70d6',
  plum: '#dda0dd',
  lavender: '#e6e6fa',
  beige: '#f5f5dc',
  khaki: '#f0e68c',
  tan: '#d2b48c',
  brown: '#a52a2a',
  chocolate: '#d2691e',
  skyblue: '#87ceeb',
  lightblue: '#add8e6',
  steelblue: '#4682b4',
  royalblue: '#4169e1',
  dodgerblue: '#1e90ff',
  lightgreen: '#90ee90',
  darkgreen: '#006400',
  seagreen: '#2e8b57',
  forestgreen: '#228b22',
  lightgray: '#d3d3d3',
  lightgrey: '#d3d3d3',
  darkgray: '#a9a9a9',
  darkgrey: '#a9a9a9',
  lightyellow: '#ffffe0',
  lightpink: '#ffb6c1',
  darkred: '#8b0000',
  darkblue: '#00008b',
  darkorange: '#ff8c00',
};

const hex2 = (n: number) =>
  Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, '0');

/** A CSS colour as `#rrggbb`, or undefined if it isn't one we can read. */
export function cssColor(raw: string): string | undefined {
  const value = raw.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])[0-9a-f]?$/.exec(value);
  if (short)
    return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  const long = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(value);
  if (long) return `#${long[1]}`;
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(value);
  if (rgb)
    return `#${hex2(Number(rgb[1]))}${hex2(Number(rgb[2]))}${hex2(Number(rgb[3]))}`;
  return NAMED[value];
}

/** Fill and stroke colours a style sets; other properties are dropped. */
export interface Paint {
  fill?: string;
  stroke?: string;
}

/** `fill:#f9f,stroke:#333,stroke-width:4px` → `{ fill, stroke }`. */
export function stylePaint(declarations: string): Paint {
  const paint: Paint = {};
  for (const part of declarations.split(/[,;]/)) {
    const [key = '', ...rest] = part.split(':');
    const color = rest.length ? cssColor(rest.join(':')) : undefined;
    if (!color) continue;
    const name = key.trim().toLowerCase();
    if (['fill', 'background', 'background-color'].includes(name))
      paint.fill = color;
    else if (name === 'stroke') paint.stroke = color;
  }
  return paint;
}

/**
 * Collects styling statements while a chart is read, then gives each node its
 * colour. Fill and stroke resolve separately, as in Mermaid's CSS: `style`
 * beats `class`/`:::` (later classes first), which beats `classDef default`.
 * The board has one tint per tile, so the fill wins over the stroke.
 */
export class MermaidStyles {
  private readonly defs = new Map<string, Paint>();
  private readonly classes = new Map<string, string[]>();
  private readonly direct = new Map<string, Paint>();
  /** Statements that styled nothing we can show, for one summary warning. */
  public readonly unreadable: string[] = [];

  /**
   * Read a styling statement. Returns false if `statement` isn't one, so the
   * caller can parse it as something else.
   */
  public read(statement: string): boolean {
    const def = /^classDef\s+([\w-]+(?:\s*,\s*[\w-]+)*)\s+(.+?);?$/.exec(
      statement,
    );
    if (def) {
      const paint = stylePaint(def[2] ?? '');
      for (const name of (def[1] ?? '').split(','))
        this.defs.set(name.trim(), paint);
      if (!paint.fill && !paint.stroke) this.unreadable.push(statement);
      return true;
    }
    const cls = /^class\s+(.+?)\s+([\w-]+)\s*;?$/.exec(statement);
    if (cls) {
      for (const id of (cls[1] ?? '').split(','))
        this.addClass(id.trim(), cls[2] ?? '');
      return true;
    }
    const style = /^style\s+([^\s,]+(?:\s*,\s*[^\s,]+)*)\s+(.+?);?$/.exec(
      statement,
    );
    if (style) {
      const paint = stylePaint(style[2] ?? '');
      for (const id of (style[1] ?? '').split(',')) {
        const key = id.trim();
        this.direct.set(key, { ...this.direct.get(key), ...paint });
      }
      if (!paint.fill && !paint.stroke) this.unreadable.push(statement);
      return true;
    }
    return false;
  }

  /** `A:::name` or `class A name`: give node `id` a class. */
  public addClass(id: string, name: string): void {
    const list = this.classes.get(id) ?? [];
    list.push(name);
    this.classes.set(id, list);
  }

  /** The colour for a node written as `id` in the chart, if it is styled. */
  public colorOf(id: string): string | undefined {
    const layers = [
      this.direct.get(id),
      ...[...(this.classes.get(id) ?? [])]
        .reverse()
        .map((n) => this.defs.get(n)),
      this.defs.get('default'),
    ];
    const pick = (key: keyof Paint) =>
      layers.find((paint) => paint?.[key])?.[key];
    return pick('fill') ?? pick('stroke');
  }

  /** Classes used on nodes but never defined, for a warning. */
  public get undefinedClasses(): string[] {
    const names = new Set([...this.classes.values()].flat());
    return [...names].filter((n) => !this.defs.has(n)).sort();
  }
}
