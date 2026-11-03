/**
 * Burn a walkthrough caption into the bottom of a recorded frame: wrapped to
 * the frame width, trimmed with an ellipsis when it would cover too much.
 */
export function drawCaption(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  caption: string,
): void {
  const size = Math.max(12, Math.round(width / 48));
  context.font = `${size}px sans-serif`;
  const lines = wrapCaption(
    caption,
    width - 48,
    (text) => context.measureText(text).width,
  );
  const visible = lines.slice(0, Math.max(1, Math.floor(height / (size * 3))));
  if (visible.length < lines.length) visible[visible.length - 1] += '…';
  const boxHeight = visible.length * size * 1.4 + 16;
  context.fillStyle = '#111827';
  context.fillRect(8, height - boxHeight - 8, width - 16, boxHeight);
  context.fillStyle = '#ffffff';
  context.textAlign = 'center';
  visible.forEach((line, i) => {
    context.fillText(
      line,
      width / 2,
      height - boxHeight + size + i * size * 1.4,
    );
  });
}

/** Break text into lines no wider than `maxWidth`, keeping its newlines. */
export function wrapCaption(
  caption: string,
  maxWidth: number,
  measure: (text: string) => number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of caption.split('\n')) {
    let line = '';
    for (const char of paragraph) {
      if (measure(line + char) > maxWidth && line) {
        lines.push(line);
        line = '';
      }
      line += char;
    }
    lines.push(line);
  }
  return lines;
}
