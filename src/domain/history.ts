import type { DiagramDocument, DiagramEdge, DiagramNode } from './document';

type Position = Pick<DiagramNode, 'x' | 'z'>;
export type Edit =
  | { type: 'move'; id: string; from: Position; to: Position }
  | { type: 'rename'; id: string; label: string }
  | { type: 'insert'; node: DiagramNode }
  | { type: 'delete'; id: string };
interface Entry {
  edit: Edit;
  undo: () => void;
  redo: () => void;
  bytes: number;
  before: number;
  after: number;
}

/** Retains only affected graph records; one completed gesture is one entry. */
export class DocumentHistory {
  private past: Entry[] = [];
  private future: Entry[] = [];
  private bytes = 0;
  private sequence = 0;
  private revision = 0;
  private savedRevision = 0;
  constructor(
    private readonly document: DiagramDocument,
    private readonly maxEntries = 100,
    private readonly maxBytes = 8_000_000,
  ) {}
  public get canUndo(): boolean {
    return this.past.length > 0;
  }
  public get canRedo(): boolean {
    return this.future.length > 0;
  }
  public get isDirty(): boolean {
    return this.revision !== this.savedRevision;
  }
  public get token(): number {
    return this.revision;
  }
  public markSaved(token = this.revision): void {
    this.savedRevision = token;
  }
  public execute(edit: Edit): boolean {
    const doc = this.document;
    const node =
      'id' in edit ? doc.nodes.find((n) => n.id === edit.id) : undefined;
    let undo: () => void;
    let redo: () => void;
    let retained: unknown = edit;
    switch (edit.type) {
      case 'move': {
        if (!node || (edit.from.x === edit.to.x && edit.from.z === edit.to.z))
          return false;
        const from = { ...edit.from };
        const to = { ...edit.to };
        undo = () => Object.assign(node, from);
        redo = () => Object.assign(node, to);
        break;
      }
      case 'rename': {
        if (!node || node.label === edit.label) return false;
        const before = node.label;
        const after = edit.label.slice(0, 1000);
        undo = () => {
          node.label = before;
        };
        redo = () => {
          node.label = after;
        };
        retained = [edit, before];
        break;
      }
      case 'insert': {
        if (doc.nodes.some((n) => n.id === edit.node.id)) return false;
        const added = { ...edit.node };
        undo = () => {
          doc.nodes = doc.nodes.filter((n) => n.id !== added.id);
        };
        redo = () => {
          doc.nodes.push(added);
        };
        break;
      }
      case 'delete': {
        if (!node) return false;
        const ids = new Set([edit.id]);
        for (let changed = true; changed; ) {
          changed = false;
          for (const item of doc.nodes)
            if (item.parentId && ids.has(item.parentId) && !ids.has(item.id)) {
              ids.add(item.id);
              changed = true;
            }
        }
        const nodes = doc.nodes.flatMap((item, index) =>
          ids.has(item.id) ? [{ item, index }] : [],
        );
        const edges = doc.edges.flatMap((item, index) =>
          ids.has(item.source) || ids.has(item.target) ? [{ item, index }] : [],
        );
        const edgeIds = new Set(edges.map(({ item }) => item.id));
        function restore<T>(
          target: T[],
          records: { item: T; index: number }[],
        ): void {
          for (const { item, index } of records) target.splice(index, 0, item);
        }
        undo = () => {
          restore<DiagramNode>(doc.nodes, nodes);
          restore<DiagramEdge>(doc.edges, edges);
        };
        redo = () => {
          doc.nodes = doc.nodes.filter((item) => !ids.has(item.id));
          doc.edges = doc.edges.filter((item) => !edgeIds.has(item.id));
        };
        retained = [edit, nodes, edges];
        break;
      }
    }
    redo();
    for (const entry of this.future) this.bytes -= entry.bytes;
    this.future = [];
    const entry: Entry = {
      edit,
      undo,
      redo,
      bytes: JSON.stringify(retained).length * 2,
      before: this.revision,
      after: ++this.sequence,
    };
    this.past.push(entry);
    this.bytes += entry.bytes;
    this.revision = entry.after;
    while (this.past.length > this.maxEntries || this.bytes > this.maxBytes) {
      const removed = this.past.shift();
      if (removed) this.bytes -= removed.bytes;
    }
    return true;
  }
  public undo(): Edit | undefined {
    const entry = this.past.pop();
    if (!entry) return;
    entry.undo();
    this.revision = entry.before;
    this.future.push(entry);
    return entry.edit;
  }
  public redo(): Edit | undefined {
    const entry = this.future.pop();
    if (!entry) return;
    entry.redo();
    this.revision = entry.after;
    this.past.push(entry);
    return entry.edit;
  }
}
