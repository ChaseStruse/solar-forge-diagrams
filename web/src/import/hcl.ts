export interface HclBlock {
  type: string;
  labels: string[];
  body: Record<string, unknown>;
}
interface Token {
  value: string;
  string?: boolean;
  newline?: boolean;
  /** Source offsets, so an expression keeps its original text. */
  start: number;
  end: number;
}
/** Two-character operators; `=` alone assigns, these never do. */
const OPERATORS = ['==', '!=', '<=', '>=', '=>'];
/** A nested `dynamic "label" { … }` block, kept for expansion. */
export interface HclDynamic {
  label: string;
  body: Record<string, unknown>;
}
/** Find the outer closing quote while retaining nested interpolation strings verbatim. */
function quotedEnd(source: string, start: number, depth = 0): number {
  if (depth > 128) throw Error('HCL string nesting exceeds 128 levels');
  let i = start + 1;
  while (i < source.length) {
    if (source[i] === '\\') {
      i += 2;
      continue;
    }
    if (source[i] === '"') return i + 1;
    if (source.slice(i, i + 3) === '$${' || source.slice(i, i + 3) === '%%{') {
      i += 3;
      continue;
    }
    if (source.slice(i, i + 2) === '${' || source.slice(i, i + 2) === '%{') {
      i += 2;
      let braces = 1;
      while (i < source.length && braces) {
        if (source[i] === '"') {
          i = quotedEnd(source, i, depth + 1);
          continue;
        }
        if (source.slice(i, i + 2) === '/*') {
          const end = source.indexOf('*/', i + 2);
          if (end < 0) throw Error('Unterminated HCL comment');
          i = end + 2;
          continue;
        }
        if (source[i] === '#' || source.slice(i, i + 2) === '//') {
          while (i < source.length && source[i] !== '\n') i++;
          continue;
        }
        if (source[i] === '{') braces++;
        if (source[i] === '}') braces--;
        i++;
      }
      if (braces) throw Error('Unterminated HCL interpolation');
      continue;
    }
    i++;
  }
  throw Error('Unterminated HCL quoted string');
}
/**
 * Read a whole HCL file: its blocks, plus top-level attributes (as in a
 * `.tfvars` file). Expressions are kept as `{ $expr }` with their source text;
 * strings with templates are kept raw.
 */
export function parseHclFile(source: string): {
  blocks: HclBlock[];
  attributes: Record<string, unknown>;
} {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i] ?? '';
    if (ch === '\n') {
      tokens.push({ value: '\n', newline: true, start: i, end: i + 1 });
      i++;
      continue;
    }
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '#' || source.slice(i, i + 2) === '//') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (source.slice(i, i + 2) === '/*') {
      const end = source.indexOf('*/', i + 2);
      if (end < 0) throw Error('Unterminated HCL comment');
      i = end + 2;
      continue;
    }
    if (ch === '"') {
      const start = i;
      i = quotedEnd(source, start);
      const raw = source.slice(start + 1, i - 1);
      try {
        tokens.push({
          // Templates are preserved, never executed or mistaken for literal network values.
          value:
            raw.includes('${') || raw.includes('%{')
              ? raw
              : JSON.parse(source.slice(start, i)),
          string: true,
          start,
          end: i,
        });
      } catch {
        throw Error('Invalid HCL quoted string');
      }
      continue;
    }
    if (source.slice(i, i + 2) === '<<') {
      const match = source.slice(i).match(/^<<-?([A-Za-z_]\w*)[^\n]*\n/);
      if (!match) throw Error('Invalid HCL heredoc');
      const start = i + match[0].length,
        end = new RegExp(`^\\s*${match[1]}\\s*$`, 'm').exec(
          source.slice(start),
        );
      if (!end) throw Error('Unterminated HCL heredoc');
      const from = i;
      i = start + end.index + end[0].length;
      tokens.push({
        value: source.slice(start, start + end.index),
        string: true,
        start: from,
        end: i,
      });
      continue;
    }
    if (OPERATORS.includes(source.slice(i, i + 2))) {
      tokens.push({ value: source.slice(i, i + 2), start: i, end: i + 2 });
      i += 2;
      continue;
    }
    if ('{}[]=,():'.includes(ch)) {
      tokens.push({ value: ch, start: i, end: i + 1 });
      i++;
      continue;
    }
    const start = i;
    while (
      i < source.length &&
      !/[\s{}[\]=,():]/.test(source[i] ?? '') &&
      !OPERATORS.includes(source.slice(i, i + 2)) &&
      source[i] !== '"'
    )
      i++;
    tokens.push({ value: source.slice(start, i), start, end: i });
  }
  let at = 0,
    depth = 0;
  const peek = () => tokens[at];
  const take = () => {
    const t = tokens[at++];
    if (!t) throw Error('Unexpected end of HCL');
    return t;
  };
  const separators = () => {
    while (peek()?.newline || (!peek()?.string && peek()?.value === ',')) at++;
  };
  const expression = (): unknown => {
    const parts: Token[] = [];
    let brackets = 0;
    while (peek()) {
      const t = peek();
      if (!t) break;
      if (parts.length && !brackets && tokens[at + 1]?.value === '=') break;
      if (
        !t.string &&
        !brackets &&
        (t.newline || [',', '}', ']'].includes(t.value))
      )
        break;
      if (!t.string && ['(', '[', '{'].includes(t.value)) brackets++;
      if (!t.string && [')', ']', '}'].includes(t.value)) brackets--;
      parts.push(take());
    }
    if (!parts.length) throw Error('Missing HCL value');
    if (parts.length === 1) {
      const t = parts[0];
      if (t?.string) return t.value;
      if (t?.value === 'true') return true;
      if (t?.value === 'false') return false;
      if (t?.value === 'null') return null;
      if (t && /^-?\d+(\.\d+)?$/.test(t.value)) return Number(t.value);
    }
    const first = parts[0];
    const last = parts.at(-1);
    return {
      $expr: first && last ? source.slice(first.start, last.end).trim() : '',
    };
  };
  const comprehension = (): boolean => {
    let next = at + 1;
    while (tokens[next]?.newline) next++;
    return (
      !tokens[next]?.string &&
      tokens[next]?.value === 'for' &&
      !['=', ':'].includes(tokens[next + 1]?.value ?? '')
    );
  };
  const value = (): unknown => {
    if (!peek()?.string && peek()?.value === '[' && comprehension())
      return expression();
    if (!peek()?.string && peek()?.value === '[') {
      take();
      const values: unknown[] = [];
      separators();
      while (peek()?.string || peek()?.value !== ']') {
        if (!peek()) throw Error('Unterminated HCL list');
        values.push(value());
        separators();
      }
      take();
      return values;
    }
    if (!peek()?.string && peek()?.value === '{' && comprehension())
      return expression();
    if (!peek()?.string && peek()?.value === '{') {
      take();
      return body(true).attributes;
    }
    return expression();
  };
  const body = (
    nested: boolean,
  ): { attributes: Record<string, unknown>; blocks: HclBlock[] } => {
    if (++depth > 128) throw Error('HCL nesting exceeds 128 levels');
    const attributes: Record<string, unknown> = {},
      blocks: HclBlock[] = [];
    separators();
    while (peek() && (peek()?.string || peek()?.value !== '}')) {
      const name = take().value;
      if (peek()?.value === '=' || peek()?.value === ':') {
        take();
        attributes[name] = value();
      } else {
        const labels: string[] = [];
        while (peek()?.string) labels.push(take().value);
        if (take().value !== '{') throw Error(`Expected { after HCL ${name}`);
        const child = body(true),
          block = { type: name, labels, body: child.attributes };
        blocks.push(block);
        // `dynamic "ingress" { … }` generates `ingress` blocks; keep its label.
        const key = name === 'dynamic' && labels[0] ? '__dynamic' : name;
        const entry: unknown =
          key === '__dynamic'
            ? ({
                label: labels[0] ?? '',
                body: block.body,
              } satisfies HclDynamic)
            : block.body;
        const existing = attributes[key];
        attributes[key] = [...(Array.isArray(existing) ? existing : []), entry];
      }
      separators();
    }
    if (nested) {
      if (take().value !== '}') throw Error('Unterminated HCL block');
    } else if (peek()) throw Error('Unexpected HCL closing brace');
    depth--;
    return { attributes, blocks };
  };
  return body(false);
}
