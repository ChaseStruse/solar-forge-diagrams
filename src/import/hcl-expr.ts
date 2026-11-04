/**
 * HCL expressions and templates for Terraform import: a small parser and an
 * evaluator for literal values. Nothing here runs code or touches files; values
 * that are only known after `terraform apply` (resource IDs, unset variables)
 * stay unknown, and unknown references keep their resolved address so the
 * importer can still connect resources.
 */

export type Value =
  | string
  | number
  | boolean
  | null
  | Value[]
  | { [key: string]: Value }
  | Unknown
  | Ref;

/** A value the import cannot know. */
export class Unknown {
  public constructor(
    /** Source text, or a resolved address for references. */
    public readonly text: string,
    /** A reference to something addressable (`aws_vpc.main.id`). */
    public readonly ref = false,
    /** For an unresolvable string template: its original raw text. */
    public readonly template?: string,
  ) {}
}

/** Something addressable whose attributes resolve lazily. */
export abstract class Ref {
  public abstract readonly address: string;
  public abstract attr(name: string): Value;
  /** `ref[key]`; references without instances don't support it. */
  public index(key: Value): Value {
    return new Unknown(`${this.address}[${keyText(key)}]`, true);
  }
}

export class HclError extends Error {}

const keyText = (key: Value) =>
  typeof key === 'string' ? JSON.stringify(key) : String(key);

export const isUnknown = (v: Value): v is Unknown => v instanceof Unknown;
export const isObject = (v: Value): v is { [key: string]: Value } =>
  typeof v === 'object' &&
  v !== null &&
  !Array.isArray(v) &&
  !(v instanceof Unknown) &&
  !(v instanceof Ref);

// ---------------------------------------------------------------- lexer

type TokenType = 'number' | 'string' | 'ident' | 'punct' | 'eof';
interface Token {
  type: TokenType;
  value: string;
  start: number;
  end: number;
}
const PUNCT = [
  '...',
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '=>',
  '[*]',
  '.*',
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  ',',
  '.',
  ':',
  '?',
  '!',
  '+',
  '-',
  '*',
  '/',
  '%',
  '<',
  '>',
  '=',
];

/** End of the `${…}` or `%{…}` that opens before `i`: the index of its `}`. */
function interpolationEnd(source: string, i: number): number {
  let braces = 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '"') {
      i = stringEnd(source, i);
      continue;
    }
    if (ch === '{') braces++;
    if (ch === '}' && --braces === 0) return i;
    i++;
  }
  throw new HclError('Unterminated template interpolation');
}
/** Index just past the closing quote of the string opening at `start`. */
function stringEnd(source: string, start: number): number {
  let i = start + 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '"') return i + 1;
    if (source.startsWith('$${', i) || source.startsWith('%%{', i)) {
      i += 3;
      continue;
    }
    if (source.startsWith('${', i) || source.startsWith('%{', i)) {
      i = interpolationEnd(source, i + 2) + 1;
      continue;
    }
    i++;
  }
  throw new HclError('Unterminated string');
}

class Lexer {
  private pos: number;
  private peeked: Token | undefined;
  public constructor(
    public readonly source: string,
    start = 0,
  ) {
    this.pos = start;
  }
  public peek(): Token {
    this.peeked ??= this.read();
    return this.peeked;
  }
  public next(): Token {
    const token = this.peek();
    this.peeked = undefined;
    return token;
  }
  private read(): Token {
    const s = this.source;
    for (;;) {
      while (this.pos < s.length && /\s/.test(s[this.pos] ?? '')) this.pos++;
      if (s[this.pos] === '#' || s.startsWith('//', this.pos)) {
        while (this.pos < s.length && s[this.pos] !== '\n') this.pos++;
        continue;
      }
      if (s.startsWith('/*', this.pos)) {
        const end = s.indexOf('*/', this.pos + 2);
        if (end < 0) throw new HclError('Unterminated comment');
        this.pos = end + 2;
        continue;
      }
      break;
    }
    const start = this.pos;
    if (start >= s.length) return { type: 'eof', value: '', start, end: start };
    const rest = s.slice(start);
    const number = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(rest);
    if (number) {
      this.pos += number[0].length;
      return { type: 'number', value: number[0], start, end: this.pos };
    }
    const ident = /^[\p{L}_][\p{L}\p{N}_-]*/u.exec(rest);
    if (ident) {
      // `a-b` is one identifier in HCL, but not a trailing `-` before `>`.
      let word = ident[0];
      while (word.endsWith('-')) word = word.slice(0, -1);
      this.pos += word.length;
      return { type: 'ident', value: word, start, end: this.pos };
    }
    if (rest[0] === '"') {
      this.pos = stringEnd(s, start);
      return {
        type: 'string',
        value: s.slice(start + 1, this.pos - 1),
        start,
        end: this.pos,
      };
    }
    const heredoc = /^<<-?([A-Za-z_]\w*)[^\n]*\n/.exec(rest);
    if (heredoc) {
      const bodyStart = start + heredoc[0].length;
      const close = new RegExp(`^\\s*${heredoc[1]}\\s*$`, 'm').exec(
        s.slice(bodyStart),
      );
      if (!close) throw new HclError('Unterminated heredoc');
      this.pos = bodyStart + close.index + close[0].length;
      return {
        type: 'string',
        value: s.slice(bodyStart, bodyStart + close.index),
        start,
        end: this.pos,
      };
    }
    for (const punct of PUNCT)
      if (rest.startsWith(punct)) {
        this.pos += punct.length;
        return { type: 'punct', value: punct, start, end: this.pos };
      }
    throw new HclError(`Unexpected character ${JSON.stringify(rest[0])}`);
  }
}

// ---------------------------------------------------------------- AST

type Traversal = { kind: 'attr'; name: string } | { kind: 'index'; key: Node };
export type Node = { start: number; end: number } & (
  | { kind: 'literal'; value: Value }
  | { kind: 'template'; parts: Part[]; raw: string }
  | { kind: 'variable'; name: string }
  | { kind: 'attr'; object: Node; name: string }
  | { kind: 'index'; object: Node; key: Node }
  | { kind: 'splat'; object: Node; each: Traversal[] }
  | { kind: 'call'; name: string; args: Node[]; expand: boolean }
  | { kind: 'tuple'; items: Node[] }
  | { kind: 'object'; entries: { key: Node; value: Node }[] }
  | {
      kind: 'for';
      keyVar?: string;
      valueVar: string;
      collection: Node;
      key?: Node;
      value: Node;
      condition?: Node;
      object: boolean;
      group: boolean;
    }
  | { kind: 'unary'; op: string; operand: Node }
  | { kind: 'binary'; op: string; left: Node; right: Node }
  | { kind: 'conditional'; condition: Node; whenTrue: Node; whenFalse: Node }
);
export type Part =
  | { kind: 'text'; text: string }
  | { kind: 'interp'; expr: Node }
  | { kind: 'if'; condition: Node; whenTrue: Part[]; whenFalse: Part[] }
  | {
      kind: 'for';
      keyVar?: string;
      valueVar: string;
      collection: Node;
      body: Part[];
    };

// ---------------------------------------------------------------- parser

const BINARY: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '<': 4,
  '<=': 4,
  '>': 4,
  '>=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
};
/** Expression nesting deep enough for real configuration, shallow enough to be safe. */
const MAX_DEPTH = 200;

class Parser {
  private depth = 0;
  public constructor(private readonly lex: Lexer) {}
  private expect(value: string): Token {
    const token = this.lex.next();
    if (token.value !== value || token.type === 'string')
      throw new HclError(`Expected ${value}`);
    return token;
  }
  private is(value: string): boolean {
    const token = this.lex.peek();
    return token.type === 'punct' && token.value === value;
  }
  public expression(): Node {
    if (++this.depth > MAX_DEPTH) throw new HclError('Expression too deep');
    try {
      const condition = this.binary(0);
      if (!this.is('?')) return condition;
      this.lex.next();
      const whenTrue = this.expression();
      this.expect(':');
      const whenFalse = this.expression();
      return {
        kind: 'conditional',
        condition,
        whenTrue,
        whenFalse,
        start: condition.start,
        end: whenFalse.end,
      };
    } finally {
      this.depth--;
    }
  }
  private binary(min: number): Node {
    let left = this.unary();
    for (;;) {
      const token = this.lex.peek();
      const precedence = token.type === 'punct' ? BINARY[token.value] : 0;
      if (!precedence || precedence <= min) return left;
      this.lex.next();
      const right = this.binary(precedence);
      left = {
        kind: 'binary',
        op: token.value,
        left,
        right,
        start: left.start,
        end: right.end,
      };
    }
  }
  private unary(): Node {
    const token = this.lex.peek();
    if (
      token.type === 'punct' &&
      (token.value === '!' || token.value === '-')
    ) {
      this.lex.next();
      if (++this.depth > MAX_DEPTH) throw new HclError('Expression too deep');
      const operand = this.unary();
      this.depth--;
      return {
        kind: 'unary',
        op: token.value,
        operand,
        start: token.start,
        end: operand.end,
      };
    }
    return this.postfix(this.primary());
  }
  /** Attribute access, indexes and splats after a value. */
  private postfix(node: Node): Node {
    for (;;) {
      if (this.is('.')) {
        this.lex.next();
        const token = this.lex.next();
        if (token.type === 'number') {
          // Legacy `list.0` index.
          node = {
            kind: 'index',
            object: node,
            key: {
              kind: 'literal',
              value: Number(token.value),
              start: token.start,
              end: token.end,
            },
            start: node.start,
            end: token.end,
          };
          continue;
        }
        if (token.type !== 'ident') throw new HclError('Expected a name');
        node = {
          kind: 'attr',
          object: node,
          name: token.value,
          start: node.start,
          end: token.end,
        };
        continue;
      }
      if (this.is('[*]') || this.is('.*')) {
        this.lex.next();
        const each: Traversal[] = [];
        let end = this.lex.peek().start;
        for (;;) {
          if (this.is('.')) {
            this.lex.next();
            const name = this.lex.next();
            if (name.type !== 'ident') throw new HclError('Expected a name');
            each.push({ kind: 'attr', name: name.value });
            end = name.end;
          } else if (this.is('[') && !this.is('[*]')) {
            this.lex.next();
            const key = this.expression();
            end = this.expect(']').end;
            each.push({ kind: 'index', key });
          } else break;
        }
        node = { kind: 'splat', object: node, each, start: node.start, end };
        continue;
      }
      if (this.is('[')) {
        this.lex.next();
        const key = this.expression();
        const close = this.expect(']');
        node = {
          kind: 'index',
          object: node,
          key,
          start: node.start,
          end: close.end,
        };
        continue;
      }
      return node;
    }
  }
  private primary(): Node {
    const token = this.lex.next();
    const { start, end } = token;
    if (token.type === 'number')
      return { kind: 'literal', value: Number(token.value), start, end };
    if (token.type === 'string')
      return {
        kind: 'template',
        parts: parseTemplate(token.value),
        raw: token.value,
        start,
        end,
      };
    if (token.type === 'ident') {
      if (token.value === 'true' || token.value === 'false')
        return { kind: 'literal', value: token.value === 'true', start, end };
      if (token.value === 'null')
        return { kind: 'literal', value: null, start, end };
      if (this.is('(')) {
        this.lex.next();
        const args: Node[] = [];
        let expand = false;
        while (!this.is(')')) {
          args.push(this.expression());
          if (this.is('...')) {
            this.lex.next();
            expand = true;
          }
          if (!this.is(',')) break;
          this.lex.next();
        }
        const close = this.expect(')');
        return {
          kind: 'call',
          name: token.value,
          args,
          expand,
          start,
          end: close.end,
        };
      }
      return { kind: 'variable', name: token.value, start, end };
    }
    if (token.value === '(') {
      const inner = this.expression();
      const close = this.expect(')');
      return { ...inner, start, end: close.end };
    }
    if (token.value === '[') return this.tuple(start);
    if (token.value === '{') return this.object(start);
    throw new HclError(`Unexpected ${JSON.stringify(token.value || 'end')}`);
  }
  public forHead(): { keyVar?: string; valueVar: string; collection: Node } {
    const first = this.lex.next();
    if (first.type !== 'ident') throw new HclError('Expected a name after for');
    let keyVar: string | undefined;
    let valueVar = first.value;
    if (this.is(',')) {
      this.lex.next();
      const second = this.lex.next();
      if (second.type !== 'ident') throw new HclError('Expected a name');
      keyVar = first.value;
      valueVar = second.value;
    }
    const keyword = this.lex.next();
    if (keyword.value !== 'in') throw new HclError('Expected in');
    const collection = this.expression();
    return { ...(keyVar ? { keyVar } : {}), valueVar, collection };
  }
  private isFor(): boolean {
    const token = this.lex.peek();
    return token.type === 'ident' && token.value === 'for';
  }
  private tuple(start: number): Node {
    if (this.isFor()) {
      this.lex.next();
      const head = this.forHead();
      this.expect(':');
      const value = this.expression();
      let condition: Node | undefined;
      if (this.lex.peek().value === 'if') {
        this.lex.next();
        condition = this.expression();
      }
      const close = this.expect(']');
      return {
        kind: 'for',
        ...head,
        value,
        ...(condition ? { condition } : {}),
        object: false,
        group: false,
        start,
        end: close.end,
      };
    }
    const items: Node[] = [];
    while (!this.is(']')) {
      items.push(this.expression());
      if (!this.is(',')) break;
      this.lex.next();
    }
    const close = this.expect(']');
    return { kind: 'tuple', items, start, end: close.end };
  }
  private object(start: number): Node {
    if (this.isFor()) {
      this.lex.next();
      const head = this.forHead();
      this.expect(':');
      const key = this.expression();
      this.expect('=>');
      const value = this.expression();
      let group = false;
      if (this.is('...')) {
        this.lex.next();
        group = true;
      }
      let condition: Node | undefined;
      if (this.lex.peek().value === 'if') {
        this.lex.next();
        condition = this.expression();
      }
      const close = this.expect('}');
      return {
        kind: 'for',
        ...head,
        key,
        value,
        ...(condition ? { condition } : {}),
        object: true,
        group,
        start,
        end: close.end,
      };
    }
    const entries: { key: Node; value: Node }[] = [];
    while (!this.is('}')) {
      // A bare name is a literal key, as in HCL: `{ name = value }`.
      const token = this.lex.peek();
      let key: Node;
      if (token.type === 'ident') {
        this.lex.next();
        key = {
          kind: 'literal',
          value: token.value,
          start: token.start,
          end: token.end,
        };
      } else key = this.expression();
      const assign = this.lex.next();
      if (assign.value !== '=' && assign.value !== ':')
        throw new HclError('Expected = in object');
      entries.push({ key, value: this.expression() });
      if (this.is(',')) this.lex.next();
    }
    const close = this.expect('}');
    return { kind: 'object', entries, start, end: close.end };
  }
  public done(): void {
    if (this.lex.peek().type !== 'eof')
      throw new HclError(`Unexpected ${JSON.stringify(this.lex.peek().value)}`);
  }
}

/** Parse one HCL expression. */
export function parseExpression(source: string): Node {
  const parser = new Parser(new Lexer(source));
  const node = parser.expression();
  parser.done();
  return node;
}

const ESCAPES: Record<string, string> = {
  n: '\n',
  r: '\r',
  t: '\t',
  '"': '"',
  '\\': '\\',
};
function decodeEscapes(text: string): string {
  return text.replace(
    /\\(u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/g,
    (match, code: string) => {
      if (code.length > 1) {
        const point = Number.parseInt(code.slice(1), 16);
        return point <= 0x10ffff ? String.fromCodePoint(point) : match;
      }
      return ESCAPES[code] ?? match;
    },
  );
}

/** Parse a string template's raw text into literal and interpolated parts. */
export function parseTemplate(raw: string): Part[] {
  const root: Part[] = [];
  // Open `%{ if }` / `%{ for }` directives, innermost last.
  const stack: { part: Part; target: Part[] }[] = [];
  let target = root;
  let text = '';
  let stripNext = false;
  const flush = (stripEnd: boolean) => {
    let value = decodeEscapes(text);
    if (stripNext) value = value.trimStart();
    if (stripEnd) value = value.trimEnd();
    if (value) target.push({ kind: 'text', text: value });
    text = '';
  };
  let i = 0;
  while (i < raw.length) {
    if (raw.startsWith('$${', i) || raw.startsWith('%%{', i)) {
      text += raw.slice(i + 1, i + 3);
      i += 3;
      continue;
    }
    const interp = raw.startsWith('${', i);
    const directive = raw.startsWith('%{', i);
    if (!interp && !directive) {
      text += raw[i];
      i++;
      continue;
    }
    const close = interpolationEnd(raw, i + 2);
    let inner = raw.slice(i + 2, close);
    const stripBefore = inner.startsWith('~');
    const stripAfter = inner.endsWith('~');
    if (stripBefore) inner = inner.slice(1);
    if (stripAfter) inner = inner.slice(0, -1);
    flush(stripBefore);
    stripNext = stripAfter;
    i = close + 1;
    if (interp) {
      target.push({ kind: 'interp', expr: parseExpression(inner) });
      continue;
    }
    const words = inner.trim();
    const [keyword = ''] = words.split(/\s+/, 1);
    if (keyword === 'if') {
      const part: Part = {
        kind: 'if',
        condition: parseExpression(words.slice(2)),
        whenTrue: [],
        whenFalse: [],
      };
      target.push(part);
      stack.push({ part, target });
      target = part.whenTrue;
    } else if (keyword === 'else') {
      const open = stack.at(-1)?.part;
      if (open?.kind !== 'if') throw new HclError('%{ else } outside %{ if }');
      target = open.whenFalse;
    } else if (keyword === 'endif' || keyword === 'endfor') {
      const open = stack.pop();
      if (!open || open.part.kind !== (keyword === 'endif' ? 'if' : 'for'))
        throw new HclError(`Unexpected %{ ${keyword} }`);
      target = open.target;
    } else if (keyword === 'for') {
      const parser = new Parser(new Lexer(words.slice(3)));
      const head = parser.forHead();
      parser.done();
      const part: Part = { kind: 'for', ...head, body: [] };
      target.push(part);
      stack.push({ part, target });
      target = part.body;
    } else throw new HclError(`Unknown template directive ${keyword}`);
  }
  flush(false);
  if (stack.length) throw new HclError('Unclosed template directive');
  return root;
}

// ---------------------------------------------------------------- evaluator

export interface Scope {
  /** A top-level name: `var`, `local`, a resource type, `count`, … */
  root(name: string): Value;
  /** A function call by name, or undefined if there is no such function. */
  call(name: string, args: Value[], node: Node): Value | undefined;
}

/** Thrown when a function reads files or is unknown; the caller can report it. */
export class Unsupported extends HclError {}

/** Truthiness for conditions: HCL only accepts booleans (and their strings). */
function bool(value: Value): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new HclError('Condition is not a boolean');
}
function num(value: Value): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(+value))
    return Number(value);
  throw new HclError('Expected a number');
}
/** HCL's string conversion for templates and string functions. */
export function str(value: Value): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  throw new HclError('Expected a string');
}
/** Deep equality for `==`. */
export function equal(a: Value, b: Value): boolean {
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => equal(v, b[i] ?? null));
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((k) => k in b && equal(a[k] ?? null, b[k] ?? null))
    );
  }
  return a === b;
}
/** Map keys in HCL's iteration order (lexical). */
export const sortedKeys = (o: { [key: string]: Value }) =>
  Object.keys(o).sort();
/** Whether a value is unknown anywhere inside. */
export function hasUnknown(value: Value): boolean {
  if (value instanceof Unknown || value instanceof Ref) return true;
  if (Array.isArray(value)) return value.some(hasUnknown);
  if (isObject(value)) return Object.values(value).some(hasUnknown);
  return false;
}

/** Cap on values built by one expression, so a bad `range` can't hang the import. */
const MAX_ITEMS = 10_000;

export class Evaluator {
  public constructor(
    private readonly scope: Scope,
    private readonly source: string,
  ) {}
  private text(node: { start: number; end: number }): string {
    return this.source.slice(node.start, node.end);
  }
  /** Unknown standing for a whole sub-expression. */
  private unknown(node: Node): Unknown {
    return new Unknown(this.text(node));
  }
  public evaluate(node: Node, env: Map<string, Value> = new Map()): Value {
    switch (node.kind) {
      case 'literal':
        return node.value;
      case 'template':
        return this.template(node, env);
      case 'variable': {
        if (env.has(node.name)) return env.get(node.name) ?? null;
        return this.scope.root(node.name);
      }
      case 'attr':
        return this.attr(this.evaluate(node.object, env), node.name, node);
      case 'index': {
        const object = this.evaluate(node.object, env);
        const key = this.evaluate(node.key, env);
        return this.index(object, key, node);
      }
      case 'splat': {
        const object = this.evaluate(node.object, env);
        if (object instanceof Unknown) return this.unknown(node);
        const items = Array.isArray(object)
          ? object
          : object === null
            ? []
            : isObject(object)
              ? sortedKeys(object).map((k) => object[k] ?? null)
              : [object];
        return items.map((item) => {
          let value = item;
          for (const step of node.each)
            value =
              step.kind === 'attr'
                ? this.attr(value, step.name, node)
                : this.index(value, this.evaluate(step.key, env), node);
          return value;
        });
      }
      case 'call': {
        let args = node.args.map((arg, i) =>
          // try/can evaluate their own arguments.
          node.name === 'try' || node.name === 'can'
            ? { node: arg, i }
            : this.evaluate(arg, env),
        );
        if (node.name === 'try' || node.name === 'can') {
          for (const arg of node.args) {
            try {
              const value = this.evaluate(arg, env);
              return node.name === 'can' ? true : value;
            } catch (error) {
              if (!(error instanceof HclError)) throw error;
              if (node.name === 'can') return false;
            }
          }
          if (node.name === 'can') return false;
          throw new HclError('No try() argument succeeded');
        }
        if (node.expand) {
          const last = args.at(-1) as Value;
          if (last instanceof Unknown) return this.unknown(node);
          if (!Array.isArray(last)) throw new HclError('... expects a list');
          args = [...args.slice(0, -1), ...last];
        }
        const values = args as Value[];
        const result = this.scope.call(node.name, values, node);
        if (result === undefined)
          throw new Unsupported(`Function ${node.name} is not supported`);
        // A function whose input is wholly unknown has an unknown result.
        if (result instanceof Unknown && !result.ref) return this.unknown(node);
        return result;
      }
      case 'tuple':
        return node.items.map((item) => this.evaluate(item, env));
      case 'object': {
        const result: { [key: string]: Value } = {};
        for (const entry of node.entries) {
          const key = this.evaluate(entry.key, env);
          if (key instanceof Unknown || key instanceof Ref)
            return this.unknown(node);
          result[str(key)] = this.evaluate(entry.value, env);
        }
        return result;
      }
      case 'for':
        return this.forExpression(node, env);
      case 'unary': {
        const operand = this.evaluate(node.operand, env);
        if (operand instanceof Unknown || operand instanceof Ref)
          return this.unknown(node);
        return node.op === '!' ? !bool(operand) : -num(operand);
      }
      case 'binary':
        return this.binary(node, env);
      case 'conditional': {
        const condition = this.evaluate(node.condition, env);
        if (condition instanceof Unknown || condition instanceof Ref)
          return this.unknown(node);
        return bool(condition)
          ? this.evaluate(node.whenTrue, env)
          : this.evaluate(node.whenFalse, env);
      }
    }
  }
  public attr(object: Value, name: string, node: Node): Value {
    if (object instanceof Ref) return object.attr(name);
    if (object instanceof Unknown)
      return object.ref
        ? new Unknown(`${object.text}.${name}`, true)
        : this.unknown(node);
    if (isObject(object)) {
      if (!(name in object))
        throw new HclError(`Unsupported attribute ${name}`);
      return object[name] ?? null;
    }
    throw new HclError(`Cannot read ${name} here`);
  }
  public index(object: Value, key: Value, node: Node): Value {
    if (key instanceof Unknown || key instanceof Ref) return this.unknown(node);
    if (object instanceof Ref) return object.index(key);
    if (object instanceof Unknown)
      return object.ref
        ? new Unknown(`${object.text}[${keyText(key)}]`, true)
        : this.unknown(node);
    if (Array.isArray(object)) {
      const i = num(key);
      if (!Number.isInteger(i) || i < 0 || i >= object.length)
        throw new HclError('Index out of range');
      return object[i] ?? null;
    }
    if (isObject(object)) {
      const k = str(key);
      if (!(k in object)) throw new HclError(`Missing key ${k}`);
      return object[k] ?? null;
    }
    throw new HclError('Cannot index this value');
  }
  /** Each key and value of a collection, in iteration order. */
  public entries(collection: Value): [Value, Value][] {
    if (Array.isArray(collection)) return collection.map((v, i) => [i, v]);
    if (isObject(collection))
      return sortedKeys(collection).map((k) => [k, collection[k] ?? null]);
    throw new HclError('Cannot iterate over this value');
  }
  private forExpression(
    node: Extract<Node, { kind: 'for' }>,
    env: Map<string, Value>,
  ): Value {
    const collection = this.evaluate(node.collection, env);
    if (collection instanceof Unknown || collection instanceof Ref)
      return this.unknown(node);
    const list: Value[] = [];
    const object: { [key: string]: Value } = {};
    for (const [key, value] of this.entries(collection)) {
      const inner = new Map(env);
      inner.set(node.valueVar, value);
      if (node.keyVar) inner.set(node.keyVar, key);
      if (node.condition) {
        const keep = this.evaluate(node.condition, inner);
        if (keep instanceof Unknown || keep instanceof Ref)
          return this.unknown(node);
        if (!bool(keep)) continue;
      }
      if (list.length >= MAX_ITEMS) throw new HclError('Too many items');
      if (!node.object || !node.key) {
        list.push(this.evaluate(node.value, inner));
        continue;
      }
      const k = this.evaluate(node.key, inner);
      if (k instanceof Unknown || k instanceof Ref) return this.unknown(node);
      const name = str(k);
      const v = this.evaluate(node.value, inner);
      if (node.group) {
        const group = object[name];
        object[name] = [...(Array.isArray(group) ? group : []), v];
      } else {
        if (name in object) throw new HclError(`Duplicate key ${name}`);
        object[name] = v;
      }
    }
    return node.object ? object : list;
  }
  private binary(
    node: Extract<Node, { kind: 'binary' }>,
    env: Map<string, Value>,
  ): Value {
    const left = this.evaluate(node.left, env);
    // && and || short-circuit, as in Terraform 1.x for known values.
    if (node.op === '&&' && left === false) return false;
    if (node.op === '||' && left === true) return true;
    const right = this.evaluate(node.right, env);
    if (hasUnknown(left) || hasUnknown(right)) return this.unknown(node);
    switch (node.op) {
      case '==':
        return equal(left, right);
      case '!=':
        return !equal(left, right);
      case '&&':
        return bool(left) && bool(right);
      case '||':
        return bool(left) || bool(right);
      case '<':
        return num(left) < num(right);
      case '<=':
        return num(left) <= num(right);
      case '>':
        return num(left) > num(right);
      case '>=':
        return num(left) >= num(right);
      case '+':
        return num(left) + num(right);
      case '-':
        return num(left) - num(right);
      case '*':
        return num(left) * num(right);
      case '/':
        return num(left) / num(right);
      case '%':
        return num(left) % num(right);
    }
    throw new HclError(`Unknown operator ${node.op}`);
  }
  private template(
    node: Extract<Node, { kind: 'template' }>,
    env: Map<string, Value>,
  ): Value {
    const [only] = node.parts;
    // "${x}" is x itself, keeping its type (and its address if unknown).
    if (node.parts.length === 1 && only?.kind === 'interp')
      return this.evaluate(only.expr, env);
    const text = this.parts(node.parts, env);
    return text instanceof Unknown
      ? new Unknown(this.text(node), false, node.raw)
      : text;
  }
  private parts(parts: Part[], env: Map<string, Value>): string | Unknown {
    let out = '';
    for (const part of parts) {
      if (part.kind === 'text') {
        out += part.text;
        continue;
      }
      if (part.kind === 'interp') {
        const value = this.evaluate(part.expr, env);
        if (hasUnknown(value)) return new Unknown('');
        out += value === null ? '' : str(value);
        continue;
      }
      if (part.kind === 'if') {
        const condition = this.evaluate(part.condition, env);
        if (hasUnknown(condition)) return new Unknown('');
        const inner = this.parts(
          bool(condition) ? part.whenTrue : part.whenFalse,
          env,
        );
        if (inner instanceof Unknown) return inner;
        out += inner;
        continue;
      }
      const collection = this.evaluate(part.collection, env);
      if (hasUnknown(collection)) return new Unknown('');
      for (const [key, value] of this.entries(collection)) {
        const scoped = new Map(env);
        scoped.set(part.valueVar, value);
        if (part.keyVar) scoped.set(part.keyVar, key);
        const inner = this.parts(part.body, scoped);
        if (inner instanceof Unknown) return inner;
        out += inner;
      }
    }
    return out;
  }
}
