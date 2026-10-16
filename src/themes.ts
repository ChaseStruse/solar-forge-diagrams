/** Colours for the 3D board. Service tiles mix the theme base with their own colour. */
export interface ScenePalette {
  sky: readonly [string, string, string];
  glow: string;
  fog: string;
  grid: readonly [string, string];
  gridOpacity: number;
  /** Tile body base and how strongly the service colour tints it (0–1). */
  tile: string;
  tileTint: number;
  /** Inset top face base and service tint. */
  face: string;
  faceTint: number;
  /** Wire outline base and service tint; groups use their boundary colour. */
  outline: string;
  outlineTint: number;
  group: string;
  groupOpacity: number;
  shadow: string;
  shadowOpacity: number;
  selected: string;
  edge: string;
  edgeHover: string;
  edgeSelected: string;
  haloOpacity: number;
  /** Bright pulses that travel along connections. */
  flow: string;
  port: string;
  handle: string;
  guide: string;
  nodeLabel: { background: string; border: string; text: string };
  edgeLabel: { background: string; text: string };
  groupLabel: string;
  glyph: string;
  note: { paper: string; text: string };
  text: string;
  ambient: number;
}
export interface Theme {
  id: string;
  name: string;
  dark: boolean;
  /** CSS custom properties consumed by style.css. */
  css: Record<string, string>;
  scene: ScenePalette;
}

const cyberpunk: Theme = {
  id: 'cyberpunk',
  name: 'Cyberpunk',
  dark: true,
  css: {
    bg: '#07040f',
    'bg-top': '#0a0518',
    'bg-mid': '#120a2a',
    'bg-bottom': '#050a18',
    'bg-glow': '#3b0f5c',
    panel: '#0d0920',
    'panel-raised': '#160f33',
    hover: '#221749',
    input: '#0a0717',
    shadow: '#000000',
    border: '#35276a',
    'border-strong': '#5b40a8',
    divider: '#271d4d',
    text: '#eef6ff',
    'text-soft': '#d2d9ff',
    'text-muted': '#aaa7d8',
    muted: '#8b87c0',
    faint: '#7470a8',
    accent: '#00f0ff',
    'accent-strong': '#8af9ff',
    'on-accent': '#04000f',
    'accent-soft': '#0a2838',
    'accent-border': '#00a3b3',
    'accent-text': '#7ff8ff',
    'accent-dim': '#4c8d9c',
    danger: '#ff3c6f',
    ok: '#39ff9c',
    hot: '#ff2a6d',
  },
  scene: {
    sky: ['#0b0520', '#160a35', '#05081a'],
    glow: '#4a1070',
    fog: '#0b0520',
    grid: ['#ff2a6d', '#2a1c66'],
    gridOpacity: 0.32,
    tile: '#120b2a',
    tileTint: 0.3,
    face: '#150d30',
    faceTint: 0.38,
    outline: '#ffffff',
    outlineTint: 0.9,
    group: '#1a1040',
    groupOpacity: 0.18,
    shadow: '#000000',
    shadowOpacity: 0.55,
    selected: '#fcee0a',
    edge: '#00e5ff',
    edgeHover: '#b0fbff',
    edgeSelected: '#fcee0a',
    haloOpacity: 0.22,
    flow: '#ff2a6d',
    port: '#ff2a6d',
    handle: '#fcee0a',
    guide: '#ff2a6d',
    nodeLabel: { background: '#0c0720', border: '#ff2a6d', text: '#f4f8ff' },
    edgeLabel: { background: '#140a30', text: '#8af9ff' },
    groupLabel: '#c9b8ff',
    glyph: '#fcee0a',
    note: { paper: '#fcee0a', text: '#150a2a' },
    text: '#eef6ff',
    ambient: 2,
  },
};

const solar: Theme = {
  id: 'solar-forge',
  name: 'Solar Forge',
  dark: true,
  css: {
    bg: '#090f17',
    'bg-top': '#0b101a',
    'bg-mid': '#0c1721',
    'bg-bottom': '#0b1720',
    'bg-glow': '#26374b',
    panel: '#101925',
    'panel-raised': '#111b29',
    hover: '#1b2838',
    input: '#0c1420',
    shadow: '#07101b',
    border: '#344155',
    'border-strong': '#46566c',
    divider: '#293546',
    text: '#dce4ed',
    'text-soft': '#c4cfda',
    'text-muted': '#a7b7ca',
    muted: '#8d9db2',
    faint: '#7f91a7',
    accent: '#efb56a',
    'accent-strong': '#ffd095',
    'on-accent': '#20170e',
    'accent-soft': '#332a1e',
    'accent-border': '#bd8a46',
    'accent-text': '#f2c48a',
    'accent-dim': '#ab8e67',
    danger: '#d18c8c',
    ok: '#88b690',
    hot: '#ff9d3c',
  },
  scene: {
    sky: ['#0a101a', '#102432', '#0c1b25'],
    glow: '#294057',
    fog: '#0b111a',
    grid: ['#62503a', '#253543'],
    gridOpacity: 0.22,
    tile: '#172b3a',
    tileTint: 0.18,
    face: '#2c4456',
    faceTint: 0.22,
    outline: '#778895',
    outlineTint: 0.45,
    group: '#172c3a',
    groupOpacity: 0.12,
    shadow: '#02080d',
    shadowOpacity: 0.4,
    selected: '#ffae42',
    edge: '#ffe1a2',
    edgeHover: '#fff4dc',
    edgeSelected: '#ff9d3c',
    haloOpacity: 0.12,
    flow: '#fff1c9',
    port: '#ffc778',
    handle: '#f4f7fb',
    guide: '#ff9d3c',
    nodeLabel: { background: '#14202b', border: '#41505e', text: '#e9eef4' },
    edgeLabel: { background: '#182431', text: '#e9eef4' },
    groupLabel: '#93a6b6',
    glyph: '#f6d7a5',
    note: { paper: '#f6d58a', text: '#2a2010' },
    text: '#e9eef4',
    ambient: 2,
  },
};

const nord: Theme = {
  id: 'nord',
  name: 'Nord',
  dark: true,
  css: {
    bg: '#242933',
    'bg-top': '#262c37',
    'bg-mid': '#2b313d',
    'bg-bottom': '#232832',
    'bg-glow': '#3b4456',
    panel: '#2e3440',
    'panel-raised': '#353c4a',
    hover: '#3b4252',
    input: '#272c36',
    shadow: '#151920',
    border: '#4c566a',
    'border-strong': '#5e6a82',
    divider: '#3f4758',
    text: '#eceff4',
    'text-soft': '#d8dee9',
    'text-muted': '#bcc4d3',
    muted: '#9aa4b7',
    faint: '#848ea2',
    accent: '#88c0d0',
    'accent-strong': '#a6d6e3',
    'on-accent': '#1e252f',
    'accent-soft': '#33444f',
    'accent-border': '#6ea6b6',
    'accent-text': '#9fd3e1',
    'accent-dim': '#7a9aa6',
    danger: '#d08770',
    ok: '#a3be8c',
    hot: '#ebcb8b',
  },
  scene: {
    sky: ['#262c37', '#2e3542', '#232832'],
    glow: '#434c5e',
    fog: '#262c37',
    grid: ['#5e81ac', '#3b4252'],
    gridOpacity: 0.3,
    tile: '#3b4252',
    tileTint: 0.22,
    face: '#434c5e',
    faceTint: 0.28,
    outline: '#d8dee9',
    outlineTint: 0.55,
    group: '#3b4252',
    groupOpacity: 0.2,
    shadow: '#151920',
    shadowOpacity: 0.35,
    selected: '#ebcb8b',
    edge: '#88c0d0',
    edgeHover: '#d8f1f7',
    edgeSelected: '#ebcb8b',
    haloOpacity: 0.14,
    flow: '#eceff4',
    port: '#88c0d0',
    handle: '#eceff4',
    guide: '#bf616a',
    nodeLabel: { background: '#2e3440', border: '#4c566a', text: '#eceff4' },
    edgeLabel: { background: '#353c4a', text: '#d8dee9' },
    groupLabel: '#b3bccb',
    glyph: '#ebcb8b',
    note: { paper: '#ebcb8b', text: '#2e3440' },
    text: '#eceff4',
    ambient: 2.2,
  },
};

const daylight: Theme = {
  id: 'daylight',
  name: 'Daylight',
  dark: false,
  css: {
    bg: '#eef1f6',
    'bg-top': '#f7f9fc',
    'bg-mid': '#eef2f7',
    'bg-bottom': '#e6ebf2',
    'bg-glow': '#ffffff',
    panel: '#ffffff',
    'panel-raised': '#f3f6fa',
    hover: '#e9eef5',
    input: '#f7f9fc',
    shadow: '#7d8aa0',
    border: '#cfd7e3',
    'border-strong': '#a9b5c7',
    divider: '#dfe5ee',
    text: '#17202c',
    'text-soft': '#2c394b',
    'text-muted': '#4a586c',
    muted: '#5d6b80',
    faint: '#6f7c90',
    accent: '#0b6bcb',
    'accent-strong': '#2f86de',
    'on-accent': '#ffffff',
    'accent-soft': '#e2eefb',
    'accent-border': '#6aa6e6',
    'accent-text': '#0a5aab',
    'accent-dim': '#5a87b5',
    danger: '#c2334d',
    ok: '#2e8a4a',
    hot: '#e0457b',
  },
  scene: {
    sky: ['#f7f9fc', '#eef2f7', '#e3e9f1'],
    glow: '#ffffff',
    fog: '#eef2f7',
    grid: ['#a9b8cc', '#d6dee9'],
    gridOpacity: 0.55,
    tile: '#ffffff',
    tileTint: 0.16,
    face: '#ffffff',
    faceTint: 0.1,
    outline: '#5d6b80',
    outlineTint: 0.75,
    group: '#c9d5e6',
    groupOpacity: 0.25,
    shadow: '#55627a',
    shadowOpacity: 0.18,
    selected: '#2f86de',
    edge: '#3b4c66',
    edgeHover: '#0b6bcb',
    edgeSelected: '#e0457b',
    haloOpacity: 0.08,
    flow: '#0b6bcb',
    port: '#0b6bcb',
    handle: '#17202c',
    guide: '#e0457b',
    nodeLabel: { background: '#ffffff', border: '#cfd7e3', text: '#17202c' },
    edgeLabel: { background: '#f3f6fa', text: '#2c394b' },
    groupLabel: '#4a586c',
    glyph: '#4a586c',
    note: { paper: '#ffe58a', text: '#2a2010' },
    text: '#17202c',
    ambient: 2.6,
  },
};

export const themes: readonly Theme[] = [cyberpunk, solar, nord, daylight];
export const defaultTheme = cyberpunk;
export function findTheme(id: string | null | undefined): Theme {
  return themes.find((theme) => theme.id === id) ?? defaultTheme;
}
/** Apply a theme's CSS variables to the document root. */
export function applyThemeCss(
  theme: Theme,
  root = document.documentElement,
): void {
  for (const [name, value] of Object.entries(theme.css))
    root.style.setProperty(`--${name}`, value);
  root.style.colorScheme = theme.dark ? 'dark' : 'light';
  root.dataset.theme = theme.id;
}
