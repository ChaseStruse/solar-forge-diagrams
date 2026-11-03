/** One position in a flowchart layer: a real node, or a slot a long link passes through. */
export interface FlowSlot {
  id: string;
  virtual: boolean;
}

/**
 * Layered ordering for flowcharts, in the classic Sugiyama style:
 *
 * 1. Break cycles by ignoring links that loop back to a step already on the
 *    current path, starting from steps nothing leads to, then from steps
 *    entered from outside this container.
 * 2. Rank each step one layer after its furthest predecessor.
 * 3. Give links that skip layers a virtual slot in every layer they cross, so
 *    they do not run through the nodes in between.
 * 4. Order each layer by the average position of its neighbours, sweeping
 *    down, up and down again, to reduce crossings.
 *
 * Returns layers from first to last. Deterministic for the same input.
 */
export interface FlowLayers {
  layers: FlowSlot[][];
  /** Each slot's neighbours in the layer before and the layer after. */
  up: ReadonlyMap<string, readonly string[]>;
  down: ReadonlyMap<string, readonly string[]>;
}
export function flowLayers(
  ids: readonly string[],
  links: ReadonlyMap<string, ReadonlySet<string>>,
  entries: ReadonlySet<string> = new Set(),
): FlowLayers {
  const sorted = [...ids].sort();
  const known = new Set(sorted);
  const next = (id: string) =>
    [...(links.get(id) ?? [])].filter((t) => known.has(t) && t !== id).sort();

  // 1. Depth-first search; a link to a step still on the stack loops back.
  const indegree = new Map(sorted.map((id) => [id, 0]));
  for (const id of sorted)
    for (const t of next(id)) indegree.set(t, (indegree.get(t) ?? 0) + 1);
  const starts = [
    ...sorted.filter((id) => !indegree.get(id)),
    ...sorted.filter((id) => entries.has(id)),
    ...sorted,
  ];
  const state = new Map<string, 'open' | 'done'>();
  const forward = new Map(sorted.map((id) => [id, [] as string[]]));
  for (const start of starts) {
    if (state.has(start)) continue;
    const stack: { id: string; targets: string[] }[] = [
      { id: start, targets: next(start) },
    ];
    state.set(start, 'open');
    while (stack.length) {
      const top = stack[stack.length - 1];
      if (!top) break;
      const target = top.targets.shift();
      if (target === undefined) {
        state.set(top.id, 'done');
        stack.pop();
        continue;
      }
      if (state.get(target) === 'open') continue; // loops back: ignore
      forward.get(top.id)?.push(target);
      if (!state.has(target)) {
        state.set(target, 'open');
        stack.push({ id: target, targets: next(target) });
      }
    }
  }

  // 2. Longest-path ranking over the remaining forward links.
  const rank = new Map(sorted.map((id) => [id, 0]));
  const remaining = new Map(sorted.map((id) => [id, 0]));
  for (const targets of forward.values())
    for (const t of targets) remaining.set(t, (remaining.get(t) ?? 0) + 1);
  const queue = sorted.filter((id) => !remaining.get(id));
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i] as string;
    for (const t of forward.get(id) ?? []) {
      rank.set(t, Math.max(rank.get(t) ?? 0, (rank.get(id) ?? 0) + 1));
      remaining.set(t, (remaining.get(t) ?? 0) - 1);
      if (!remaining.get(t)) queue.push(t);
    }
  }

  // 3. Layers, with a virtual slot wherever a link crosses a layer.
  const depth = Math.max(0, ...rank.values());
  const layers: FlowSlot[][] = Array.from({ length: depth + 1 }, () => []);
  for (const id of sorted)
    layers[rank.get(id) ?? 0]?.push({ id, virtual: false });
  const up = new Map<string, string[]>();
  const down = new Map<string, string[]>();
  const join = (a: string, b: string) => {
    down.set(a, [...(down.get(a) ?? []), b]);
    up.set(b, [...(up.get(b) ?? []), a]);
  };
  for (const [source, targets] of forward)
    for (const target of targets) {
      const from = rank.get(source) ?? 0;
      const to = rank.get(target) ?? 0;
      let previous = source;
      for (let r = from + 1; r < to; r++) {
        const id = `\u0000${source}\u0000${target}\u0000${r}`;
        layers[r]?.push({ id, virtual: true });
        join(previous, id);
        previous = id;
      }
      join(previous, target);
    }

  // 4. Barycentre sweeps: down, up, down.
  const position = new Map<string, number>();
  const remember = (layer: FlowSlot[]) => {
    for (const [i, slot] of layer.entries()) position.set(slot.id, i);
  };
  const reorder = (layer: FlowSlot[], neighbours: Map<string, string[]>) => {
    const keyed = layer.map((slot, i) => {
      const at = (neighbours.get(slot.id) ?? [])
        .map((n) => position.get(n))
        .filter((p): p is number => p !== undefined);
      return {
        slot,
        key: at.length ? at.reduce((a, b) => a + b, 0) / at.length : i,
      };
    });
    keyed.sort((a, b) => a.key - b.key || (a.slot.id < b.slot.id ? -1 : 1));
    layer.splice(0, layer.length, ...keyed.map((k) => k.slot));
    remember(layer);
  };
  for (const layer of layers) remember(layer);
  for (const layer of layers.slice(1)) reorder(layer, up);
  for (const layer of layers.slice(0, -1).reverse()) reorder(layer, down);
  for (const layer of layers.slice(1)) reorder(layer, up);
  return { layers, up, down };
}

/**
 * Cross-axis centres for every slot, by priority placement: a slot moves
 * towards the average of its neighbours, links that skip layers move first
 * and stay straight, and lower-priority slots are pushed aside rather than
 * overlapping. Sweeps down, up and down again. Positions may be negative;
 * keep layer order and at least `gap` between neighbouring slots.
 */
export function flowPositions(
  { layers, up, down }: FlowLayers,
  size: (slot: FlowSlot) => number,
  gap: number,
): Map<string, number> {
  const at = new Map<string, number>();
  const sweep = (
    order: FlowSlot[][],
    neighbours: ReadonlyMap<string, readonly string[]>,
  ) => {
    for (const layer of order) {
      const sizes = layer.map(size);
      const desired = layer.map((slot) => {
        const around = neighbours.get(slot.id) ?? [];
        // Follow a long link's lane so it stays one straight line.
        const lane = around.filter((n) => n.startsWith('\u0000'));
        const placed = (lane.length === 1 ? lane : around)
          .map((n) => at.get(n))
          .filter((p): p is number => p !== undefined);
        return placed.length
          ? placed.reduce((a, b) => a + b, 0) / placed.length
          : undefined;
      });
      const x = placeLayer(
        sizes,
        desired,
        layer.map((slot) =>
          slot.virtual ? 1000 : (neighbours.get(slot.id)?.length ?? 0),
        ),
        gap,
        layer.map((slot) => at.get(slot.id)),
      );
      for (const [i, slot] of layer.entries()) at.set(slot.id, x[i] ?? 0);
    }
  };
  sweep(layers, up);
  sweep([...layers].reverse(), down);
  sweep(layers, up);
  return at;
}

/** Place one layer's slots in order, honouring priorities; returns centres. */
function placeLayer(
  sizes: readonly number[],
  desired: readonly (number | undefined)[],
  priority: readonly number[],
  gap: number,
  previous: readonly (number | undefined)[],
): number[] {
  const n = sizes.length;
  const apart = (i: number) =>
    ((sizes[i - 1] ?? 0) + (sizes[i] ?? 0)) / 2 + gap;
  const wanted = desired.filter((d): d is number => d !== undefined);
  const centre = wanted.length
    ? wanted.reduce((a, b) => a + b, 0) / wanted.length
    : 0;
  const total = sizes.reduce((a, b) => a + b, 0) + gap * Math.max(0, n - 1);
  const x: number[] = [];
  let edge = centre - total / 2;
  for (let i = 0; i < n; i++) {
    x.push(previous[i] ?? edge + (sizes[i] ?? 0) / 2);
    edge += (sizes[i] ?? 0) + gap;
  }
  // Settle any overlap left from an earlier sweep.
  for (let i = 1; i < n; i++)
    x[i] = Math.max(x[i] ?? 0, (x[i - 1] ?? 0) + apart(i));
  const ranked = [...Array(n).keys()].sort(
    (a, b) => (priority[b] ?? 0) - (priority[a] ?? 0) || a - b,
  );
  for (const i of ranked) {
    const want = desired[i];
    const own = priority[i] ?? 0;
    if (want === undefined) continue;
    if (want > (x[i] ?? 0)) {
      let limit = Number.POSITIVE_INFINITY;
      let need = 0;
      for (let j = i + 1; j < n; j++) {
        need += apart(j);
        if ((priority[j] ?? 0) >= own) {
          limit = (x[j] ?? 0) - need;
          break;
        }
      }
      x[i] = Math.min(want, limit);
      for (let j = i + 1; j < n; j++)
        x[j] = Math.max(x[j] ?? 0, (x[j - 1] ?? 0) + apart(j));
    } else {
      let limit = Number.NEGATIVE_INFINITY;
      let need = 0;
      for (let j = i - 1; j >= 0; j--) {
        need += apart(j + 1);
        if ((priority[j] ?? 0) >= own) {
          limit = (x[j] ?? 0) + need;
          break;
        }
      }
      x[i] = Math.max(want, limit);
      for (let j = i - 1; j >= 0; j--)
        x[j] = Math.min(x[j] ?? 0, (x[j + 1] ?? 0) - apart(j + 1));
    }
  }
  return x;
}
