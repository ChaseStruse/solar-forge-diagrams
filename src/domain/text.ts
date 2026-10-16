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
