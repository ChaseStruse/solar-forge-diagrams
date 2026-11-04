/**
 * Terraform's built-in functions that are pure: same inputs, same output, no
 * files, network or clock. Anything else stays unknown.
 */
import {
  equal,
  HclError,
  hasUnknown,
  isObject,
  Ref,
  sortedKeys,
  str,
  Unknown,
  Unsupported,
  type Value,
} from './hcl-expr';

type Fn = (args: Value[]) => Value;

/** Functions that read files or change every run: never evaluated. */
const NOT_EVALUATED = new Set([
  'file',
  'fileexists',
  'fileset',
  'filebase64',
  'filebase64sha256',
  'filebase64sha512',
  'filemd5',
  'filesha1',
  'filesha256',
  'filesha512',
  'templatefile',
  'abspath',
  'pathexpand',
  'timestamp',
  'plantimestamp',
  'uuid',
  'uuidv5',
  'bcrypt',
]);

const MAX_ITEMS = 10_000;
const n = (v: Value): number => {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(+v)) return +v;
  throw new HclError('Expected a number');
};
const int = (v: Value): number => {
  const value = n(v);
  if (!Number.isInteger(value)) throw new HclError('Expected a whole number');
  return value;
};
const list = (v: Value): Value[] => {
  if (Array.isArray(v)) return v;
  throw new HclError('Expected a list');
};
const map = (v: Value): { [key: string]: Value } => {
  if (isObject(v)) return v;
  throw new HclError('Expected a map');
};
const distinct = (items: Value[]): Value[] => {
  const out: Value[] = [];
  for (const item of items)
    if (!out.some((seen) => equal(seen, item))) out.push(item);
  return out;
};
const arg = (args: Value[], i: number): Value => {
  if (i >= args.length) throw new HclError('Missing function argument');
  return args[i] ?? null;
};

// ---------------------------------------------------------------- IPv4 CIDR

function parseCidr(prefix: Value): { base: number; bits: number } {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(
    str(prefix),
  );
  if (!match) throw new HclError('Only IPv4 CIDR prefixes are evaluated');
  const octets = match.slice(1, 5).map(Number);
  const bits = Number(match[5]);
  if (octets.some((o) => o > 255) || bits > 32)
    throw new HclError('Invalid CIDR prefix');
  const address = octets.reduce((a, o) => a * 256 + o, 0);
  const size = 2 ** (32 - bits);
  return { base: address - (address % size), bits };
}
const ipText = (address: number) =>
  [24, 16, 8, 0]
    .map((shift) => Math.floor(address / 2 ** shift) % 256)
    .join('.');
function cidrSubnet(prefix: Value, newbits: Value, netnum: Value): string {
  const { base, bits } = parseCidr(prefix);
  const extra = int(newbits);
  const number = int(netnum);
  if (extra < 0 || bits + extra > 32)
    throw new HclError('cidrsubnet would exceed 32 bits');
  if (number < 0 || number >= 2 ** extra)
    throw new HclError('cidrsubnet network number out of range');
  const size = 2 ** (32 - bits - extra);
  return `${ipText(base + number * size)}/${bits + extra}`;
}

// ---------------------------------------------------------------- format

function format(spec: string, values: Value[]): string {
  let next = 0;
  return spec.replace(
    /%(?:\[(\d+)\])?([-+ 0#]*)(\d+)?(?:\.(\d+))?([a-zA-Z%])/g,
    (_match, position, flags: string, width, precision, verb: string) => {
      if (verb === '%') return '%';
      const index = position ? Number(position) - 1 : next++;
      if (index >= values.length) throw new HclError('format: too few values');
      const value = values[index] ?? null;
      let out: string;
      switch (verb) {
        case 's':
        case 'v':
          out =
            typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean'
              ? String(value)
              : JSON.stringify(value);
          break;
        case 'q':
          out = JSON.stringify(str(value));
          break;
        case 'd':
          out = String(Math.trunc(n(value)));
          break;
        case 'f':
          out = n(value).toFixed(precision ? Number(precision) : 6);
          break;
        case 'e':
          out = n(value).toExponential(precision ? Number(precision) : 6);
          break;
        case 'x':
          out = Math.trunc(n(value)).toString(16);
          break;
        case 'X':
          out = Math.trunc(n(value)).toString(16).toUpperCase();
          break;
        case 'o':
          out = Math.trunc(n(value)).toString(8);
          break;
        case 'b':
          out = Math.trunc(n(value)).toString(2);
          break;
        case 't':
          if (typeof value !== 'boolean') throw new HclError('Expected a bool');
          out = String(value);
          break;
        default:
          throw new HclError(`format: unsupported verb %${verb}`);
      }
      if (flags.includes('+') && /^[\d.]/.test(out) && 'dfe'.includes(verb))
        out = `+${out}`;
      const pad = width ? Number(width) : 0;
      if (out.length < pad)
        out = flags.includes('-')
          ? out.padEnd(pad)
          : flags.includes('0') && 'dfexXob'.includes(verb)
            ? out.padStart(pad, '0')
            : out.padStart(pad);
      return out;
    },
  );
}

// ---------------------------------------------------------------- table

const functions: Record<string, Fn> = {
  // numbers
  abs: (a) => Math.abs(n(arg(a, 0))),
  ceil: (a) => Math.ceil(n(arg(a, 0))),
  floor: (a) => Math.floor(n(arg(a, 0))),
  log: (a) => Math.log(n(arg(a, 0))) / Math.log(n(arg(a, 1))),
  max: (a) => Math.max(...a.map(n)),
  min: (a) => Math.min(...a.map(n)),
  pow: (a) => n(arg(a, 0)) ** n(arg(a, 1)),
  signum: (a) => Math.sign(n(arg(a, 0))),
  parseint: (a) => {
    const value = Number.parseInt(str(arg(a, 0)), int(arg(a, 1)));
    if (Number.isNaN(value)) throw new HclError('parseint: not a number');
    return value;
  },
  // strings
  chomp: (a) => str(arg(a, 0)).replace(/(\r?\n)+$/, ''),
  endswith: (a) => str(arg(a, 0)).endsWith(str(arg(a, 1))),
  format: (a) => format(str(arg(a, 0)), a.slice(1)),
  formatlist: (a) => {
    const lists = a.slice(1);
    const length = Math.max(
      0,
      ...lists.map((v) => (Array.isArray(v) ? v.length : 0)),
    );
    return Array.from({ length }, (_, i) =>
      format(
        str(arg(a, 0)),
        lists.map((v) => (Array.isArray(v) ? (v[i] ?? null) : v)),
      ),
    );
  },
  indent: (a) =>
    str(arg(a, 1)).replace(/\n/g, `\n${' '.repeat(int(arg(a, 0)))}`),
  join: (a) =>
    list(arg(a, 1))
      .map(str)
      .join(str(arg(a, 0))),
  lower: (a) => str(arg(a, 0)).toLowerCase(),
  upper: (a) => str(arg(a, 0)).toUpperCase(),
  replace: (a) => {
    const text = str(arg(a, 0));
    const search = str(arg(a, 1));
    const replacement = str(arg(a, 2));
    const regex = /^\/(.*)\/$/s.exec(search);
    return regex
      ? text.replace(new RegExp(regex[1] ?? '', 'g'), replacement)
      : text.split(search).join(replacement);
  },
  split: (a) => str(arg(a, 1)).split(str(arg(a, 0))),
  startswith: (a) => str(arg(a, 0)).startsWith(str(arg(a, 1))),
  strcontains: (a) => str(arg(a, 0)).includes(str(arg(a, 1))),
  strrev: (a) => [...str(arg(a, 0))].reverse().join(''),
  substr: (a) => {
    const chars = [...str(arg(a, 0))];
    let offset = int(arg(a, 1));
    if (offset < 0) offset += chars.length;
    const length = int(arg(a, 2));
    return chars
      .slice(offset, length < 0 ? undefined : offset + length)
      .join('');
  },
  title: (a) => str(arg(a, 0)).replace(/\b\p{L}/gu, (c) => c.toUpperCase()),
  trim: (a) => {
    const chars = [...str(arg(a, 1))];
    let text = str(arg(a, 0));
    while (text && chars.includes(text[0] ?? '')) text = text.slice(1);
    while (text && chars.includes(text.at(-1) ?? '')) text = text.slice(0, -1);
    return text;
  },
  trimprefix: (a) => {
    const text = str(arg(a, 0));
    const prefix = str(arg(a, 1));
    return text.startsWith(prefix) ? text.slice(prefix.length) : text;
  },
  trimsuffix: (a) => {
    const text = str(arg(a, 0));
    const suffix = str(arg(a, 1));
    return suffix && text.endsWith(suffix)
      ? text.slice(0, -suffix.length)
      : text;
  },
  trimspace: (a) => str(arg(a, 0)).trim(),
  // collections
  alltrue: (a) => list(arg(a, 0)).every((v) => v === true || v === 'true'),
  anytrue: (a) => list(arg(a, 0)).some((v) => v === true || v === 'true'),
  chunklist: (a) => {
    const items = list(arg(a, 0));
    const size = int(arg(a, 1));
    if (size <= 0) return [items];
    const out: Value[] = [];
    for (let i = 0; i < items.length; i += size)
      out.push(items.slice(i, i + size));
    return out;
  },
  coalesce: (a) => {
    for (const v of a) if (v !== null && v !== '') return v;
    throw new HclError('coalesce: no non-empty value');
  },
  coalescelist: (a) => {
    for (const v of a) if (Array.isArray(v) && v.length) return v;
    throw new HclError('coalescelist: no non-empty list');
  },
  compact: (a) => list(arg(a, 0)).filter((v) => v !== null && v !== ''),
  concat: (a) => a.flatMap(list),
  contains: (a) => list(arg(a, 0)).some((v) => equal(v, arg(a, 1))),
  distinct: (a) => distinct(list(arg(a, 0))),
  element: (a) => {
    const items = list(arg(a, 0));
    if (!items.length) throw new HclError('element: empty list');
    const i = int(arg(a, 1));
    return items[((i % items.length) + items.length) % items.length] ?? null;
  },
  flatten: (a) => {
    const out: Value[] = [];
    const walk = (v: Value) => {
      if (Array.isArray(v)) v.forEach(walk);
      else out.push(v);
    };
    walk(list(arg(a, 0)));
    return out;
  },
  index: (a) => {
    const i = list(arg(a, 0)).findIndex((v) => equal(v, arg(a, 1)));
    if (i < 0) throw new HclError('index: value not found');
    return i;
  },
  keys: (a) => sortedKeys(map(arg(a, 0))),
  length: (a) => {
    const v = arg(a, 0);
    if (typeof v === 'string') return [...v].length;
    if (Array.isArray(v)) return v.length;
    return Object.keys(map(v)).length;
  },
  lookup: (a) => {
    const m = map(arg(a, 0));
    const key = str(arg(a, 1));
    if (key in m) return m[key] ?? null;
    if (a.length > 2) return arg(a, 2);
    throw new HclError(`lookup: missing key ${key}`);
  },
  merge: (a) =>
    Object.assign(
      {},
      ...a.filter((v) => v !== null).map((v) => map(v)),
    ) as Value,
  one: (a) => {
    const items = list(arg(a, 0));
    if (items.length > 1) throw new HclError('one: more than one element');
    return items[0] ?? null;
  },
  range: (a) => {
    const [start, limit, step] =
      a.length === 1
        ? [0, n(arg(a, 0)), 1]
        : [n(arg(a, 0)), n(arg(a, 1)), a.length > 2 ? n(arg(a, 2)) : 1];
    if (!step) throw new HclError('range: step cannot be zero');
    const out: number[] = [];
    for (let v = start; step > 0 ? v < limit : v > limit; v += step) {
      if (out.length >= MAX_ITEMS) throw new HclError('range: too long');
      out.push(v);
    }
    return out;
  },
  reverse: (a) => [...list(arg(a, 0))].reverse(),
  setintersection: (a) =>
    distinct(list(arg(a, 0))).filter((v) =>
      a.slice(1).every((other) => list(other).some((o) => equal(o, v))),
    ),
  setproduct: (a) => {
    let out: Value[][] = [[]];
    for (const set of a) {
      out = out.flatMap((prefix) => list(set).map((v) => [...prefix, v]));
      if (out.length > MAX_ITEMS) throw new HclError('setproduct: too large');
    }
    return out;
  },
  setsubtract: (a) =>
    distinct(list(arg(a, 0))).filter(
      (v) => !list(arg(a, 1)).some((o) => equal(o, v)),
    ),
  setunion: (a) => distinct(a.flatMap(list)),
  slice: (a) => list(arg(a, 0)).slice(int(arg(a, 1)), int(arg(a, 2))),
  sort: (a) => list(arg(a, 0)).map(str).sort(),
  sum: (a) => list(arg(a, 0)).reduce<number>((t, v) => t + n(v), 0),
  values: (a) => {
    const m = map(arg(a, 0));
    return sortedKeys(m).map((k) => m[k] ?? null);
  },
  zipmap: (a) => {
    const keys = list(arg(a, 0));
    const values = list(arg(a, 1));
    if (keys.length !== values.length)
      throw new HclError('zipmap: lists differ in length');
    return Object.fromEntries(keys.map((k, i) => [str(k), values[i] ?? null]));
  },
  // conversion
  tobool: (a) => {
    const v = arg(a, 0);
    if (v === null || typeof v === 'boolean') return v;
    if (v === 'true' || v === 'false') return v === 'true';
    throw new HclError('tobool: not a bool');
  },
  tolist: (a) => list(arg(a, 0)),
  tomap: (a) => map(arg(a, 0)),
  tonumber: (a) => (arg(a, 0) === null ? null : n(arg(a, 0))),
  toset: (a) => distinct(list(arg(a, 0))),
  tostring: (a) => (arg(a, 0) === null ? null : str(arg(a, 0))),
  jsonencode: (a) => JSON.stringify(arg(a, 0)),
  sensitive: (a) => arg(a, 0),
  nonsensitive: (a) => arg(a, 0),
  // IPv4 networking
  cidrhost: (a) => {
    const { base, bits } = parseCidr(arg(a, 0));
    const size = 2 ** (32 - bits);
    let host = int(arg(a, 1));
    if (host < 0) host += size;
    if (host < 0 || host >= size) throw new HclError('cidrhost out of range');
    return ipText(base + host);
  },
  cidrnetmask: (a) => {
    const { bits } = parseCidr(arg(a, 0));
    return ipText(2 ** 32 - 2 ** (32 - bits));
  },
  cidrsubnet: (a) => cidrSubnet(arg(a, 0), arg(a, 1), arg(a, 2)),
  cidrsubnets: (a) => {
    const { base, bits } = parseCidr(arg(a, 0));
    let at = base;
    const out: string[] = [];
    for (const extra of a.slice(1).map(int)) {
      const size = 2 ** (32 - bits - extra);
      // Each subnet starts at the next boundary for its own size.
      at = Math.ceil(at / size) * size;
      const subnet = `${ipText(at)}/${bits + extra}`;
      cidrSubnet(arg(a, 0), extra, (at - base) / size);
      out.push(subnet);
      at += size;
    }
    return out;
  },
};

/** Functions that look inside their arguments, so unknown items pass through. */
const STRUCTURAL = new Set([
  'coalesce',
  'coalescelist',
  'compact',
  'concat',
  'distinct',
  'element',
  'flatten',
  'keys',
  'length',
  'lookup',
  'merge',
  'one',
  'reverse',
  'slice',
  'tolist',
  'tomap',
  'toset',
  'values',
  'zipmap',
  'sensitive',
  'nonsensitive',
  'setunion',
  'chunklist',
]);

/**
 * Call a Terraform function. Returns undefined for an unknown name, throws
 * Unsupported for functions that read files or the clock, and returns
 * Unknown when an argument that decides the result is unknown.
 */
export function callFunction(name: string, args: Value[]): Value | undefined {
  if (NOT_EVALUATED.has(name))
    throw new Unsupported(
      `${name}() reads files or changes every run, so it is not evaluated`,
    );
  const fn = functions[name];
  if (!fn) return undefined;
  const whole = args.some((v) => v instanceof Unknown || v instanceof Ref);
  const inside = args.some(hasUnknown);
  if (whole || (inside && !STRUCTURAL.has(name))) return new Unknown('');
  return fn(args);
}
