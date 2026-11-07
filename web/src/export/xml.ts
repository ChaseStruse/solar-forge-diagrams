/** Characters XML 1.0 does not allow at all: C0 controls other than tab, newline and carriage return. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching these characters is the point.
const FORBIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu;
const ENTITIES: Record<string, string> = {
  '<': '&lt;',
  '>': '&gt;',
  '&': '&amp;',
  '"': '&quot;',
  "'": '&apos;',
};

/** Text safe inside XML element content and quoted attributes (SVG, draw.io). */
export const escapeXml = (text: string): string =>
  text
    .replace(FORBIDDEN, '')
    .replace(/[<>&"']/g, (char) => ENTITIES[char] ?? char);
