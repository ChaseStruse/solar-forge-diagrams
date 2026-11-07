import terminalFont from '../assets/fonts/vt323-latin-400.woff2?url';

/** Typeface for text drawn on the board, chosen independently of the theme. */
export interface BoardFont {
  id: 'theme' | 'courier' | 'terminal';
  name: string;
  /** CSS font stack; the theme's own label font when absent. */
  family?: string;
  /** Bundled font file, fetched only when the font is first chosen. */
  url?: string;
}
export const boardFonts: readonly BoardFont[] = [
  { id: 'theme', name: 'Standard' },
  {
    id: 'courier',
    name: 'Courier New',
    family:
      '"Courier New", Courier, "Liberation Mono", "Nimbus Mono PS", monospace',
  },
  {
    id: 'terminal',
    name: 'Terminal',
    family: 'VT323, "DejaVu Sans Mono", ui-monospace, monospace',
    url: terminalFont,
  },
];
export function findBoardFont(id: string | null | undefined): BoardFont {
  return (
    boardFonts.find((font) => font.id === id) ?? (boardFonts[0] as BoardFont)
  );
}
const loaded = new Map<string, Promise<void>>();
/** Resolve once the font can be drawn on a canvas; bundled faces load once. */
export function loadBoardFont(font: BoardFont): Promise<void> {
  const url = font.url;
  if (!url) return Promise.resolve();
  let promise = loaded.get(url);
  if (!promise) {
    const face = new FontFace('VT323', `url(${url}) format("woff2")`);
    promise = face.load().then((ready) => {
      document.fonts.add(ready);
    });
    // A failed load falls back to the stack and may be retried later.
    promise.catch(() => loaded.delete(url));
    loaded.set(url, promise);
  }
  return promise;
}
