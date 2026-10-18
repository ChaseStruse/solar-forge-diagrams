import type { DiagramNode } from './document';

const DEFAULT_FONT_SIZE = { text: 26, note: 18 } as const;

/** World-unit font size for text and sticky notes. */
export function fontSize(node: DiagramNode): number {
  return (
    node.fontSize ??
    (node.kind === 'note' ? DEFAULT_FONT_SIZE.note : DEFAULT_FONT_SIZE.text)
  );
}
/** Greedy word wrap that also breaks words too long for one line. */
export function wrapText(
  text: string,
  width: number,
  measure: (text: string) => number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/(\s+)/)) {
      const candidate = line + word;
      if (measure(candidate) <= width || !line.trim()) {
        line = candidate;
        // A single word wider than the box: hard-break it.
        while (measure(line) > width && line.length > 1) {
          let cut = line.length - 1;
          while (cut > 1 && measure(line.slice(0, cut)) > width) cut--;
          lines.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      } else {
        lines.push(line.trimEnd());
        line = word.trimStart();
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

/** Fit every line in both dimensions, using a caller's actual font metrics. */
export function fitText(
  text: string,
  width: number,
  height: number,
  preferred: number,
  measure: (text: string, size: number) => number,
): { size: number; lines: string[] } {
  const w = Math.max(0.01, width),
    h = Math.max(0.01, height),
    top = Math.max(0.01, preferred);
  // Advances scale with font size, so each distinct line is measured once.
  const widths = new Map<string, number>();
  const at = (line: string, size: number) => {
    let width = widths.get(line);
    if (width === undefined) {
      width = measure(line, top);
      widths.set(line, width);
    }
    return (width * size) / top;
  };
  const layout = (size: number) => wrapText(text, w, (line) => at(line, size));
  const fits = (size: number, lines: string[]) =>
    lines.length * size * 1.28 <= h &&
    lines.every((line) => at(line, size) <= w);
  const preferredLines = layout(top);
  if (fits(top, preferredLines)) return { size: top, lines: preferredLines };
  let low = 0,
    high = top;
  for (let i = 0; i < 16; i++) {
    const size = (low + high) / 2;
    if (fits(size, layout(size))) low = size;
    else high = size;
  }
  return { size: low, lines: layout(low) };
}
export function resizedFont(
  node: DiagramNode,
  from: { width: number; depth: number },
  to: { width: number; depth: number },
): number {
  return Math.max(
    4,
    Math.min(
      400,
      fontSize(node) * Math.min(to.width / from.width, to.depth / from.depth),
    ),
  );
}

/** Shared readable, multiline service caption layout for canvas and SVG. */
export function serviceCaption(
  node: Pick<DiagramNode, 'label' | 'width' | 'depth'>,
  measure: (text: string, size: number) => number,
): { size: number; lines: string[] } {
  return fitText(
    node.label,
    node.width * 0.82,
    node.depth * 0.75,
    Math.min(node.width * 0.13, node.depth * 0.25),
    measure,
  );
}
