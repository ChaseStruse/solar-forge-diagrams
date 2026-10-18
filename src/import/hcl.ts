export interface HclBlock {
  type: string;
  labels: string[];
  body: Record<string, unknown>;
}
interface Token {
  value: string;
  string?: boolean;
  newline?: boolean;
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
/** Static HCL reader. It preserves expressions as references and never evaluates code. */
export function parseHcl(source: string): HclBlock[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i] ?? '';
    if (ch === '\n') {
      tokens.push({ value: '\n', newline: true });
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
      tokens.push({
        value: source.slice(start, start + end.index),
        string: true,
      });
      i = start + end.index + end[0].length;
      continue;
    }
    if ('{}[]=,():'.includes(ch)) {
      tokens.push({ value: ch });
      i++;
      continue;
    }
    const start = i;
    while (i < source.length && !/[\s{}[\]=,():]/.test(source[i] ?? '')) i++;
    tokens.push({ value: source.slice(start, i) });
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
    while (peek()?.newline || peek()?.value === ',') at++;
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
    return {
      $expr: parts
        .map((t) => (t.string ? JSON.stringify(t.value) : t.value))
        .join(''),
    };
  };
  const comprehension = (): boolean => {
    let next = at + 1;
    while (tokens[next]?.newline) next++;
    return tokens[next]?.value === 'for';
  };
  const value = (): unknown => {
    if (!peek()?.string && peek()?.value === '[' && comprehension())
      return expression();
    if (!peek()?.string && peek()?.value === '[') {
      take();
      const values: unknown[] = [];
      separators();
      while (peek()?.value !== ']') {
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
    while (peek() && peek()?.value !== '}') {
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
        const existing = attributes[name];
        attributes[name] = [
          ...(Array.isArray(existing) ? existing : []),
          block.body,
        ];
      }
      separators();
    }
    if (nested) {
      if (take().value !== '}') throw Error('Unterminated HCL block');
    } else if (peek()) throw Error('Unexpected HCL closing brace');
    depth--;
    return { attributes, blocks };
  };
  return body(false).blocks;
}
