/**
 * Terraform HCL import: reads the root module and local child modules,
 * evaluates variables, locals, functions and expressions where their values
 * are known, and expands `count`, `for_each` and `dynamic` blocks into the
 * resource instances Terraform would plan. Nothing is executed and no file
 * outside the chosen files is read.
 */
import { type HclBlock, type HclDynamic, parseHclFile } from './hcl';
import {
  Evaluator,
  HclError,
  isObject,
  type Node,
  parseExpression,
  parseTemplate,
  Ref,
  type Scope,
  Unknown,
  Unsupported,
  type Value,
} from './hcl-expr';
import { callFunction } from './hcl-functions';
import { type InfrastructureFile, obj, type Resource } from './types';

/** Terraform arguments that placement, routing or firewall analysis reads. */
export const networkAttributes = new Set([
  'vpc_id',
  'subnet_id',
  'subnet_ids',
  'subnets',
  'availability_zone',
  'cidr_block',
  'private_ip',
  'public_ip',
  'associate_public_ip_address',
  'map_public_ip_on_launch',
  'vpc_security_group_ids',
  'security_groups',
  'security_group_id',
  'ingress',
  'egress',
  'route',
  'network_acl_id',
  'route_table_id',
  'destination_cidr_block',
  'gateway_id',
  'nat_gateway_id',
  'internet_gateway_id',
  'instance_id',
  'network_interface_id',
  'transit_gateway_id',
  'vpc_peering_connection_id',
  'db_subnet_group_name',
  'type',
  'protocol',
  'ip_protocol',
  'from_port',
  'to_port',
  'cidr_blocks',
  'cidr_ipv4',
  'self',
  'source_security_group_id',
  'referenced_security_group_id',
  'rule_no',
  'rule_number',
  'rule_action',
  'action',
]);

/** Instances per resource or module call; matches the earlier count limit. */
const MAX_INSTANCES = 100;
/** Nested module calls deep enough for real projects. */
const MAX_MODULE_DEPTH = 16;
/** Meta-arguments and blocks that describe Terraform's behaviour, not the resource. */
const META = new Set([
  'count',
  'for_each',
  'lifecycle',
  'provisioner',
  'connection',
  'provider',
  'depends_on',
]);
const MODULE_META = new Set([
  'source',
  'version',
  'count',
  'for_each',
  'providers',
  'depends_on',
]);

interface Declaration {
  type: string;
  name: string;
  body: Record<string, unknown>;
}
interface ModuleDef {
  dir: string;
  variables: Map<string, Record<string, unknown>>;
  locals: Map<string, unknown>;
  resources: Map<string, Declaration>;
  types: Set<string>;
  calls: Map<string, Record<string, unknown>>;
  outputs: Map<string, unknown>;
  providers: HclBlock[];
}

const posix = (dir: string, relative: string): string | undefined => {
  const parts = dir ? dir.split('/') : [];
  for (const part of relative.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (!parts.length) return undefined;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join('/');
};
const dirOf = (path: string) =>
  path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
const keySuffix = (key: Value) =>
  typeof key === 'number' ? `[${key}]` : `[${JSON.stringify(key)}]`;
/** The literal string in a parsed attribute, if it is one. */
const literal = (raw: unknown): string | undefined =>
  typeof raw === 'string' && !raw.includes('${') && !raw.includes('%{')
    ? raw
    : undefined;

/** A parsed value: literal, `{ $expr }`, raw template, list or object body. */
type Raw = unknown;

/** Diagnostics gathered while evaluating, reported once each. */
class Notes {
  public readonly unset = new Set<string>();
  public readonly unsupported = new Map<string, number>();
  public readonly warnings: string[] = [];
}

/** Instances a `count` or `for_each` produces. */
type Instances =
  | { kind: 'single' }
  | { kind: 'many'; keys: { key: Value; each?: Value }[]; count: boolean }
  | { kind: 'unknown'; reason: string };

/** Bindings for `count.index`, `each.key`, `each.value` in one instance. */
interface Binding {
  count?: Value;
  each?: { key: Value; value: Value };
}

class ModuleInstance {
  private readonly variableValues = new Map<string, Value>();
  private readonly localValues = new Map<string, Value>();
  private readonly localsInProgress = new Set<string>();
  private readonly resourceValues = new Map<string, Value>();
  private readonly instanceCache = new Map<string, Instances>();
  private readonly childCache = new Map<string, Value>();
  private readonly outputValues = new Map<string, Value>();
  /** Resource instance attributes being evaluated, to break reference cycles. */
  public readonly evaluating = new Set<string>();

  public constructor(
    public readonly project: Project,
    public readonly def: ModuleDef,
    /** Address prefix: '' for the root, `module.net.` or `module.net["a"].`. */
    public readonly prefix: string,
    /** Input values, evaluated lazily in the caller. */
    private readonly inputs: Map<string, () => Value>,
    public readonly depth: number,
  ) {}

  public context(binding: Binding = {}): Context {
    return new Context(this, binding);
  }

  public variable(name: string): Value {
    if (this.variableValues.has(name))
      return this.variableValues.get(name) ?? null;
    const declared = this.def.variables.get(name);
    let value: Value;
    const input = this.inputs.get(name);
    if (input) value = input();
    else if (declared && 'default' in declared)
      value = this.context().evaluate(declared.default);
    else {
      if (declared && !this.prefix) this.project.notes.unset.add(name);
      value = new Unknown(`var.${name}`);
    }
    this.variableValues.set(name, value);
    return value;
  }

  public local(name: string): Value {
    if (this.localValues.has(name)) return this.localValues.get(name) ?? null;
    if (!this.def.locals.has(name))
      throw new HclError(`No local value ${name}`);
    if (this.localsInProgress.has(name)) return new Unknown(`local.${name}`);
    this.localsInProgress.add(name);
    const value = this.context().evaluate(this.def.locals.get(name));
    this.localsInProgress.delete(name);
    this.localValues.set(name, value);
    return value;
  }

  /** How many instances a resource or module call has, and their keys. */
  public instances(key: string, body: Record<string, unknown>): Instances {
    const cached = this.instanceCache.get(key);
    if (cached) return cached;
    let result: Instances = { kind: 'single' };
    if ('count' in body) {
      const count = this.context().evaluate(body.count);
      if (typeof count !== 'number')
        result = {
          kind: 'unknown',
          reason:
            'for_each/count is unresolved; import evaluated Terraform JSON',
        };
      else if (!Number.isInteger(count) || count < 0 || count > MAX_INSTANCES)
        result = {
          kind: 'unknown',
          reason: `Terraform count is outside the supported 0–${MAX_INSTANCES} range; instances were not expanded`,
        };
      else
        result = {
          kind: 'many',
          keys: Array.from({ length: count }, (_, i) => ({ key: i })),
          count: true,
        };
    } else if ('for_each' in body) {
      const each = this.context().evaluate(body.for_each);
      const keys: { key: Value; each: Value }[] = [];
      let readable = true;
      if (Array.isArray(each)) {
        for (const item of each)
          if (typeof item === 'string') keys.push({ key: item, each: item });
          else readable = false;
      } else if (isObject(each))
        for (const k of Object.keys(each).sort())
          keys.push({ key: k, each: each[k] ?? null });
      else readable = false;
      if (!readable)
        result = {
          kind: 'unknown',
          reason:
            'for_each/count is unresolved; import evaluated Terraform JSON',
        };
      else if (keys.length > MAX_INSTANCES)
        result = {
          kind: 'unknown',
          reason: `Terraform for_each has more than ${MAX_INSTANCES} entries; instances were not expanded`,
        };
      else result = { kind: 'many', keys, count: false };
    }
    this.instanceCache.set(key, result);
    return result;
  }

  /** A resource by `type.name`: one instance, a list, a map, or unknown. */
  public resource(type: string, name: string): Value {
    const key = `${type}.${name}`;
    if (this.resourceValues.has(key))
      return this.resourceValues.get(key) ?? null;
    const address = `${this.prefix}${key}`;
    const decl = this.def.resources.get(key);
    let value: Value;
    if (!decl) value = new Unknown(address, true);
    else {
      const instances = this.instances(key, decl.body);
      if (instances.kind === 'single')
        value = new ResourceRef(this, decl, address, {});
      else if (instances.kind === 'unknown') value = new Unknown(address, true);
      else if (instances.count)
        value = instances.keys.map(
          ({ key: i }) =>
            new ResourceRef(this, decl, `${address}${keySuffix(i)}`, {
              count: i,
            }),
        );
      else
        value = Object.fromEntries(
          instances.keys.map(({ key: k, each }) => [
            String(k),
            new ResourceRef(this, decl, `${address}${keySuffix(k)}`, {
              each: { key: k, value: each ?? null },
            }),
          ]),
        );
    }
    this.resourceValues.set(key, value);
    return value;
  }

  /** A module call: its outputs, or a list or map of them. */
  public module(name: string): Value {
    if (this.childCache.has(name)) return this.childCache.get(name) ?? null;
    const children = this.project.children(this, name);
    const value: Value =
      children === undefined
        ? new Unknown(`${this.prefix}module.${name}`, true)
        : children.kind === 'single'
          ? new ModuleRef(children.instances[0] as ModuleInstance)
          : children.count
            ? children.instances.map((child) => new ModuleRef(child))
            : Object.fromEntries(
                children.instances.map((child, i) => [
                  String(children.keys[i]),
                  new ModuleRef(child),
                ]),
              );
    this.childCache.set(name, value);
    return value;
  }

  public output(name: string): Value {
    if (this.outputValues.has(name)) return this.outputValues.get(name) ?? null;
    if (!this.def.outputs.has(name))
      throw new HclError(`Module has no output ${name}`);
    const value = this.context().evaluate(this.def.outputs.get(name));
    this.outputValues.set(name, value);
    return value;
  }
}

/** One instance of a resource; configured arguments resolve to their values. */
class ResourceRef extends Ref {
  public constructor(
    private readonly module: ModuleInstance,
    private readonly decl: Declaration,
    public readonly address: string,
    private readonly binding: Binding,
  ) {
    super();
  }
  public attr(name: string): Value {
    const raw = this.decl.body[name];
    const key = `${this.address}.${name}`;
    // Arguments set in the configuration are known; computed ones (id, arn)
    // are not, but keep the address so the importer can connect them.
    if (
      raw === undefined ||
      META.has(name) ||
      (Array.isArray(raw) && raw.some((item) => isObject(item as Value))) ||
      this.module.evaluating.has(key)
    )
      return new Unknown(key, true);
    this.module.evaluating.add(key);
    try {
      return this.module.context(this.binding).evaluate(raw);
    } finally {
      this.module.evaluating.delete(key);
    }
  }
}

class ModuleRef extends Ref {
  public readonly address: string;
  public constructor(private readonly instance: ModuleInstance) {
    super();
    this.address = instance.prefix.slice(0, -1);
  }
  public attr(name: string): Value {
    return this.instance.output(name);
  }
}

/** `var`, `local`, `module` and `data` as values with lazy attributes. */
class Namespace extends Ref {
  public constructor(
    public readonly address: string,
    private readonly read: (name: string) => Value,
  ) {
    super();
  }
  public attr(name: string): Value {
    return this.read(name);
  }
}

/** Evaluation in one module instance, with `count`/`each` bound or not. */
class Context implements Scope {
  public constructor(
    private readonly module: ModuleInstance,
    private readonly binding: Binding,
  ) {}
  private get notes() {
    return this.module.project.notes;
  }
  public root(name: string): Value {
    const m = this.module;
    switch (name) {
      case 'var':
        return new Namespace('var', (n) => m.variable(n));
      case 'local':
        return new Namespace('local', (n) => m.local(n));
      case 'module':
        return new Namespace(`${m.prefix}module`, (n) => m.module(n));
      case 'data':
        return new Unknown(`${m.prefix}data`, true);
      case 'count':
        if (this.binding.count === undefined)
          throw new HclError('count.index is only available with count');
        return { index: this.binding.count };
      case 'each':
        if (!this.binding.each)
          throw new HclError('each is only available with for_each');
        return { key: this.binding.each.key, value: this.binding.each.value };
      case 'path':
        return { module: m.def.dir || '.', root: '.', cwd: '.' };
      case 'terraform':
        return { workspace: 'default' };
    }
    if (m.def.types.has(name) || /^[a-z][a-z0-9]*_[a-z0-9_]+$/.test(name))
      return new Namespace(`${m.prefix}${name}`, (n) => m.resource(name, n));
    throw new HclError(`Unknown name ${name}`);
  }
  public call(name: string, args: Value[]): Value | undefined {
    return callFunction(name, args);
  }
  /** Evaluate a parsed value: an expression, a template, a list or a body. */
  public evaluate(raw: Raw, env: Map<string, Value> = new Map()): Value {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'number' || typeof raw === 'boolean') return raw;
    if (typeof raw === 'string') {
      if (!raw.includes('${') && !raw.includes('%{')) return raw;
      return this.run(
        raw,
        env,
        () => ({
          kind: 'template',
          parts: parseTemplate(raw),
          raw,
          start: 0,
          end: raw.length,
        }),
        true,
      );
    }
    if (Array.isArray(raw)) return raw.map((item) => this.evaluate(item, env));
    const o = obj(raw);
    if (typeof o.$expr === 'string') {
      const text = o.$expr;
      return this.run(text, env, () => parseExpression(text), false);
    }
    return this.body(o, env);
  }
  /** Parse and evaluate; anything unreadable becomes unknown, as before. */
  private run(
    text: string,
    env: Map<string, Value>,
    parse: () => Node,
    template: boolean,
  ): Value {
    try {
      return new Evaluator(this, text).evaluate(parse(), env);
    } catch (error) {
      if (error instanceof Unsupported) {
        const message = error.message;
        this.notes.unsupported.set(
          message,
          (this.notes.unsupported.get(message) ?? 0) + 1,
        );
      } else if (!(error instanceof HclError)) throw error;
      // An unreadable template keeps its raw text, as the importer expects.
      return template ? new Unknown(text, false, text) : new Unknown(text);
    }
  }
  /**
   * An object literal or block body, expanding `dynamic` blocks. Labels of
   * dynamic blocks that could not be expanded are added to `unexpanded`.
   */
  public body(
    body: Record<string, unknown>,
    env: Map<string, Value> = new Map(),
    unexpanded?: string[],
  ): { [key: string]: Value } {
    const out: { [key: string]: Value } = {};
    for (const [key, raw] of Object.entries(body)) {
      if (key === '__dynamic') continue;
      out[key] = this.evaluate(raw, env);
    }
    for (const dynamic of (body.__dynamic ?? []) as HclDynamic[]) {
      const { label } = dynamic;
      // `iterator = rule` renames the block's iteration variable.
      const named = obj(dynamic.body.iterator).$expr;
      const iterator = typeof named === 'string' ? named : label;
      const collection = this.evaluate(dynamic.body.for_each, env);
      const content = (
        Array.isArray(dynamic.body.content) ? dynamic.body.content[0] : {}
      ) as Record<string, unknown>;
      const existing = out[label];
      const blocks: Value[] = Array.isArray(existing) ? [...existing] : [];
      if (!Array.isArray(collection) && !isObject(collection)) {
        unexpanded?.push(label);
        continue;
      }
      const entries: [Value, Value][] = Array.isArray(collection)
        ? collection.map((v, i) => [i, v])
        : Object.keys(collection)
            .sort()
            .map((k) => [k, collection[k] ?? null]);
      for (const [key, value] of entries) {
        const inner = new Map(env);
        inner.set(iterator, { key, value });
        blocks.push(this.body(content, inner, unexpanded));
      }
      out[label] = blocks;
    }
    return out;
  }
}

/** Plain values for the AWS importer: unknowns become `{ $expr }` again. */
function plain(value: Value): unknown {
  if (value instanceof Unknown)
    return value.template !== undefined
      ? value.template
      : { $expr: value.text };
  if (value instanceof Ref) return { $expr: value.address };
  if (Array.isArray(value)) return value.map(plain);
  if (isObject(value))
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, plain(v)]),
    );
  return value;
}

/** All modules in the chosen files, and the instances built from them. */
class Project {
  public readonly notes = new Notes();
  private readonly defs = new Map<string, ModuleDef>();
  private readonly childSets = new Map<
    ModuleInstance,
    Map<
      string,
      | {
          kind: 'single' | 'many';
          count: boolean;
          keys: Value[];
          instances: ModuleInstance[];
        }
      | undefined
    >
  >();
  private readonly warnedModules = new Set<string>();
  public readonly root: ModuleInstance;

  public constructor(files: InfrastructureFile[]) {
    const tfvars: InfrastructureFile[] = [];
    for (const file of files) {
      const path = file.name.replace(/\\/g, '/').replace(/^\.\//, '');
      if (/\.tfvars$/i.test(path)) {
        tfvars.push({ ...file, name: path });
        continue;
      }
      const dir = dirOf(path);
      const def: ModuleDef = this.defs.get(dir) ?? {
        dir,
        variables: new Map(),
        locals: new Map(),
        resources: new Map(),
        types: new Set<string>(),
        calls: new Map(),
        outputs: new Map(),
        providers: [],
      };
      this.defs.set(dir, def);
      for (const block of parseHclFile(file.content).blocks) {
        const [first, second] = block.labels;
        if (block.type === 'variable' && first)
          def.variables.set(first, block.body);
        else if (block.type === 'locals')
          for (const [k, v] of Object.entries(block.body)) def.locals.set(k, v);
        else if (block.type === 'resource') {
          if (!first || !second)
            throw Error('Terraform resource needs type and name');
          def.resources.set(`${first}.${second}`, {
            type: first,
            name: second,
            body: block.body,
          });
          def.types.add(first);
        } else if (block.type === 'module' && first)
          def.calls.set(first, block.body);
        else if (block.type === 'output' && first)
          def.outputs.set(first, block.body.value);
        else if (block.type === 'provider') def.providers.push(block);
      }
    }
    // The root is the folder no other module uses; prefer the shallowest.
    const used = new Set<string>();
    for (const def of this.defs.values())
      for (const call of def.calls.values()) {
        const source = literal(call.source);
        const dir =
          source && /^\.\.?\//.test(source)
            ? posix(def.dir, source)
            : undefined;
        if (dir !== undefined && dir !== def.dir) used.add(dir);
      }
    const roots = [...this.defs.keys()]
      .filter((dir) => !used.has(dir))
      .sort(
        (a, b) => a.split('/').length - b.split('/').length || (a < b ? -1 : 1),
      );
    const rootDir = roots[0] ?? [...this.defs.keys()].sort()[0] ?? '';
    if (roots.length > 1)
      this.notes.warnings.push(
        `Several root modules found (${roots.map((d) => d || '.').join(', ')}); imported ${rootDir || '.'}. Choose the folder of the one you want.`,
      );
    const rootDef = this.defs.get(rootDir);
    if (!rootDef) throw Error('No Terraform configuration found');
    // Variables from .tfvars: terraform.tfvars, then *.auto.tfvars, then others.
    const order = (name: string) =>
      /(^|\/)terraform\.tfvars$/i.test(name)
        ? 0
        : /\.auto\.tfvars$/i.test(name)
          ? 1
          : 2;
    const inputs = new Map<string, () => Value>();
    const holder: { root?: ModuleInstance } = {};
    for (const file of tfvars.sort(
      (a, b) => order(a.name) - order(b.name) || (a.name < b.name ? -1 : 1),
    ))
      for (const [name, raw] of Object.entries(
        parseHclFile(file.content).attributes,
      ))
        inputs.set(name, () => holder.root?.context().evaluate(raw) ?? null);
    this.root = new ModuleInstance(this, rootDef, '', inputs, 0);
    holder.root = this.root;
  }

  /** The instances of `parent`'s module call `name`, or undefined if not expandable. */
  public children(parent: ModuleInstance, name: string) {
    let calls = this.childSets.get(parent);
    if (!calls) {
      calls = new Map();
      this.childSets.set(parent, calls);
    }
    if (calls.has(name)) return calls.get(name);
    calls.set(name, undefined);
    const body = parent.def.calls.get(name);
    if (!body) return undefined;
    const address = `${parent.prefix}module.${name}`;
    const warn = (message: string) => {
      if (this.warnedModules.has(address)) return;
      this.warnedModules.add(address);
      this.notes.warnings.push(message);
    };
    const source = literal(body.source) ?? '';
    if (!/^\.\.?\//.test(source)) {
      warn(
        `Module ${address}${source ? ` (${source})` : ''} is not expanded: only local modules are read; import terraform show -json for evaluated modules`,
      );
      return undefined;
    }
    const dir = posix(parent.def.dir, source);
    const def = dir === undefined ? undefined : this.defs.get(dir);
    if (!def) {
      warn(
        `Module ${address} is not expanded: its files (${source}) were not chosen; choose the project folder to include them`,
      );
      return undefined;
    }
    if (parent.depth >= MAX_MODULE_DEPTH) {
      warn(`Module ${address} is not expanded: modules nest too deeply`);
      return undefined;
    }
    const instances = parent.instances(`module.${name}`, body);
    if (instances.kind === 'unknown') {
      warn(`Module ${address} is not expanded: ${instances.reason}`);
      return undefined;
    }
    const keys: { key: Value; each?: Value; binding: Binding }[] =
      instances.kind === 'single'
        ? [{ key: null, binding: {} }]
        : instances.keys.map(({ key, each }) => ({
            key,
            ...(each !== undefined ? { each } : {}),
            binding: instances.count
              ? { count: key }
              : { each: { key, value: each ?? null } },
          }));
    const built = keys.map(({ key, binding }) => {
      const inputs = new Map<string, () => Value>();
      const context = parent.context(binding);
      for (const [input, raw] of Object.entries(body))
        if (!MODULE_META.has(input))
          inputs.set(input, () => context.evaluate(raw));
      const prefix = `${address}${instances.kind === 'single' ? '' : keySuffix(key)}.`;
      return new ModuleInstance(this, def, prefix, inputs, parent.depth + 1);
    });
    const result = {
      kind: instances.kind,
      count: instances.kind === 'many' && instances.count,
      keys: keys.map((k) => k.key),
      instances: built,
    };
    calls.set(name, result);
    return result;
  }

  /** Every resource instance in the root module and the modules it calls. */
  public resources(region: string | undefined): Resource[] {
    const out: Resource[] = [];
    const walk = (module: ModuleInstance) => {
      for (const [key, decl] of module.def.resources) {
        const address = `${module.prefix}${key}`;
        const instances = module.instances(key, decl.body);
        const build = (id: string, binding: Binding, reason?: string) => {
          const unexpanded: string[] = [];
          const body = Object.fromEntries(
            Object.entries(decl.body).filter(([k]) => !META.has(k)),
          );
          const values = obj(
            plain(module.context(binding).body(body, new Map(), unexpanded)),
          );
          const network = unexpanded.filter((l) => networkAttributes.has(l));
          if (reason) values.__incomplete = reason;
          else if (network.length)
            values.__incomplete = `Dynamic ${network.join(', ')} blocks could not be expanded; import evaluated Terraform JSON`;
          out.push({
            id,
            type: decl.type,
            values,
            ...(region ? { region } : {}),
          });
        };
        if (instances.kind === 'single') build(address, {});
        else if (instances.kind === 'unknown') {
          this.notes.warnings.push(
            `${address}: ${instances.reason.includes('range') || instances.reason.includes('more than') ? instances.reason : 'instances were not expanded'}`,
          );
          build(
            address,
            {
              count: new Unknown('count.index'),
              each: {
                key: new Unknown('each.key'),
                value: new Unknown('each.value'),
              },
            },
            instances.reason,
          );
        } else
          for (const { key: k, each } of instances.keys)
            build(
              `${address}${keySuffix(k)}`,
              instances.count
                ? { count: k }
                : { each: { key: k, value: each ?? null } },
            );
      }
      for (const name of module.def.calls.keys()) {
        const children = this.children(module, name);
        for (const child of children?.instances ?? []) walk(child);
      }
    };
    walk(this.root);
    return out;
  }
}

/**
 * Read Terraform `.tf` (and `.tfvars`) files into resources for the AWS
 * importer. File names may include folders (`modules/net/main.tf`) so local
 * modules can be found.
 */
export function terraformResources(
  files: InfrastructureFile[],
  warnings: string[],
): Resource[] {
  const project = new Project(files);
  const context = project.root.context();
  const provider = project.root.def.providers.find(
    (p) => p.labels[0] === 'aws' && p.body.alias === undefined,
  );
  const region = provider ? context.evaluate(provider.body.region) : undefined;
  const resources = project.resources(
    typeof region === 'string' ? region : undefined,
  );
  const { notes } = project;
  warnings.push(...notes.warnings);
  // Unset variables matter where they decide the network; elsewhere (an AMI,
  // a name) they only leave a label unknown.
  const networkText = JSON.stringify(
    resources.map((r) =>
      Object.entries(r.values).filter(([k]) => networkAttributes.has(k)),
    ),
  );
  const unset = [...notes.unset]
    .filter((name) => new RegExp(`\\bvar\\.${name}\\b`).test(networkText))
    .sort();
  if (unset.length)
    warnings.push(
      `Variables without a value decide network settings: ${unset.join(', ')}. Add a default or choose a .tfvars file to evaluate them`,
    );
  for (const [message, times] of notes.unsupported)
    warnings.push(`${message}${times > 1 ? ` (${times} places)` : ''}`);
  return resources;
}
