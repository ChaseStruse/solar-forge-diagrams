import type { App } from '../app/context';
import { findService } from '../catalog/services';
import {
  type DiagramDocument,
  type DiagramEdge,
  type DiagramNode,
  MAX_TEXT,
  type Port,
  worldPosition,
} from '../domain/document';
import { branchName, journeyBranches } from '../domain/journey';
import {
  defaultTraffic,
  evaluateTraffic,
  parseNetworkRule,
} from '../domain/network';
import { fontSize, resizedFont } from '../domain/text';
import { element, field, fillOptions, inputElement } from './dom';
import { renderNetworkProperties } from './network-properties';

export interface Inspector {
  /** Show the selected node or connection in the properties panel. */
  inspect(): void;
  /** Which route actions apply to the selected connection's fork. */
  routeActions(): { active: boolean; all: boolean };
}

/**
 * The properties panel: fields for the selected component or connection,
 * architecture details, detail-diagram links, traffic rules and routes.
 */
export function installInspector(app: App): Inspector {
  const {
    state,
    scene,
    notify,
    commit,
    updateLayers,
    navigateDiagram,
    deleteSelection,
  } = app;
  const METADATA_KEYS = [
    'region',
    'environment',
    'resourceName',
    'tags',
    'notes',
  ] as const;
  function inspect(): void {
    const node = state.current.nodes.find((n) => n.id === state.selected);
    element('properties').hidden = !node;
    element('selection').textContent =
      node?.kind === 'text' || node?.kind === 'note'
        ? node.label.split('\n')[0] ||
          (node.kind === 'note' ? 'Sticky note' : 'Text')
        : (node?.label ?? '');
    inputElement('node-label').value = node?.label ?? '';
    (element('node-caption') as HTMLTextAreaElement).value =
      node?.journeyCaption ?? '';
    element('detail-controls').hidden =
      !node || !['group', 'service'].includes(node.kind);
    const detailSelect = element('node-detail') as HTMLSelectElement;
    detailSelect.replaceChildren(
      new Option('No detail diagram', ''),
      ...(state.project.details ?? []).map(
        (entry) => new Option(entry.document.title, entry.id),
      ),
    );
    detailSelect.value = node?.detailId ?? '';
    (element('detail-open') as HTMLButtonElement).disabled = !node?.detailId;
    const annotation = node?.kind === 'text' || node?.kind === 'note';
    inputElement('node-label').hidden = annotation;
    field('node-text').hidden = !annotation;
    element('node-label-caption').textContent = annotation ? 'Text' : 'Label';
    element('node-label-caption').setAttribute(
      'for',
      annotation ? 'node-text' : 'node-label',
    );
    const component = node?.kind === 'service';
    element('node-font-row').hidden = !annotation && !component;
    element('node-wrap-row').hidden = !component;
    const outgoing = node
      ? state.current.edges.filter((edge) => edge.source === node.id)
      : [];
    element('node-branch-row').hidden = outgoing.length < 2;
    if (node && outgoing.length >= 2) {
      const setting = node.journey;
      fillOptions(
        'node-branch',
        [
          ['all', 'Takes every branch'],
          ['ask', 'Asks me which way'],
          ...outgoing.map(
            (edge) =>
              [
                `fixed:${edge.id}`,
                `Active route ${branchName(state.current, edge.id)}`,
              ] as [string, string],
          ),
        ],
        setting?.mode === 'fixed'
          ? `fixed:${setting.edge}`
          : (setting?.mode ?? journeyBranches(state.current, node.id).mode),
      );
    }
    if (node) {
      field('node-text').value = node.label;
      // Components without a size fit their caption automatically.
      inputElement('node-font').value =
        node.kind === 'service'
          ? String(node.fontSize ?? '')
          : String(fontSize(node));
      inputElement('node-font').placeholder =
        node.kind === 'service' ? 'Auto' : '';
      inputElement('node-wrap').checked = Boolean(node.wrap);
      inputElement('node-color').value = node.color;
    }
    const edge = state.current.edges.find((e) => e.id === state.selectedEdge);
    element('edge-properties').hidden = !edge;
    if (node) {
      for (const key of ['x', 'z', 'width', 'depth'] as const)
        inputElement(`node-${key}`).value = String(node[key]);
      const excluded = new Set<string>([node.id]);
      for (let changed = true; changed; ) {
        changed = false;
        for (const n of state.current.nodes)
          if (n.parentId && excluded.has(n.parentId) && !excluded.has(n.id)) {
            excluded.add(n.id);
            changed = true;
          }
      }
      fillOptions(
        'node-parent',
        [
          ['', 'Board'],
          ...state.current.nodes
            .filter((n) => n.kind === 'group' && !excluded.has(n.id))
            .map((n) => [n.id, n.label] as [string, string]),
        ],
        node.parentId ?? '',
      );
      const targets = detailTargets();
      for (const key of METADATA_KEYS) {
        const input = field(`meta-${key}`) as HTMLInputElement;
        input.dataset.placeholder ??= input.placeholder;
        const values = targets.map((n) => n.metadata?.[key] ?? '');
        const same = values.every((value) => value === values[0]);
        input.value = same ? (values[0] ?? '') : '';
        input.placeholder = same
          ? (input.dataset.placeholder ?? '')
          : 'Mixed · type to set for all';
      }
      const scope = element('meta-scope');
      scope.hidden = targets.length < 2;
      scope.textContent = `Editing ${targets.length} selected objects. Changes apply to all of them.`;
      element('meta-apply-inside').hidden =
        targets.length > 1 || descendants(node.id).length === 0;
      if (targets.length > 1) {
        element('selection').textContent = `${targets.length} selected`;
        (element('meta-details') as HTMLDetailsElement).open = true;
      }
    }
    if (edge) {
      const routes = routeActions();
      element('edge-active').hidden = !routes.active;
      element('edge-all-routes').hidden = !routes.all;
      const ruleResult = evaluateTraffic(
        edge.networkRule,
        state.current.traffic ?? defaultTraffic,
      );
      element('rule-result').textContent =
        `${ruleResult.allowed ? 'Allowed' : 'Blocked'} for current traffic · ${ruleResult.reason}`;
      field('rule-action').value = edge.networkRule?.action ?? 'none';
      field('rule-protocol').value = edge.networkRule?.protocol ?? 'any';
      field('rule-port').value = String(edge.networkRule?.port ?? '');
      field('rule-source').value = edge.networkRule?.sourceCidr ?? '';
      field('rule-direction').value = edge.networkRule?.direction ?? 'any';
      updateRuleFields();
      inputElement('edge-label').value = edge.label;
      const options = state.current.nodes.map(
        (n) => [n.id, n.label] as [string, string],
      );
      fillOptions('edge-source', options, edge.source);
      fillOptions('edge-target', options, edge.target);
      field('edge-sourcePort').value = edge.sourcePort ?? '';
      field('edge-targetPort').value = edge.targetPort ?? '';
      field('edge-routing').value = edge.routing ?? 'horizontal';
      inputElement('edge-bend').value = String(edge.bend ?? 0);
    }
    element('selection-note').textContent =
      node?.kind === 'group'
        ? 'Architecture boundary'
        : node?.kind === 'text'
          ? 'Text · double-click to edit'
          : node?.kind === 'note'
            ? 'Sticky note · double-click to edit'
            : node?.shape
              ? 'Flowchart shape'
              : 'Component · double-click to rename';
    // Owner: shared value across the selection, with every owner on offer.
    const owners = [
      ...new Set(
        state.current.nodes.flatMap((n) => (n.owner ? [n.owner] : [])),
      ),
    ].sort((a, b) => a.localeCompare(b));
    element('owner-options').replaceChildren(
      ...owners.map((owner) => new Option(owner)),
    );
    const ownerTargets = node ? detailTargets() : [];
    const ownerValues = new Set(ownerTargets.map((n) => n.owner ?? ''));
    const ownerField = inputElement('node-owner');
    ownerField.value =
      ownerValues.size === 1 ? ([...ownerValues][0] ?? '') : '';
    ownerField.placeholder =
      ownerValues.size > 1
        ? 'Mixed · type to set for all'
        : 'Who does this step?';
    for (const id of ['delete', 'tool-edit']) {
      const button = element(id);
      if (button instanceof HTMLButtonElement) button.disabled = !node && !edge;
    }
    renderNetworkProperties(
      element('resource-network'),
      node,
      state.current,
      (value) =>
        commit({
          type: 'graph',
          label: 'Resource networking',
          nodes: [{ id: value.id, value }],
        }),
      notify,
    );
    updateLayers();
  }
  field('node-text').onchange = () => {
    const node = state.current.nodes.find((n) => n.id === state.selected);
    const label = field('node-text').value.slice(0, MAX_TEXT);
    if (!node || label === node.label) return;
    commit({
      type: 'graph',
      label: 'Edit text',
      nodes: [{ id: node.id, value: { ...node, label } }],
    });
  };
  field('node-font').onchange = () => {
    const node = state.current.nodes.find((n) => n.id === state.selected);
    if (node?.kind === 'service' && !field('node-font').value.trim()) {
      const value = { ...node };
      delete value.fontSize;
      commit({
        type: 'graph',
        label: 'Text size',
        nodes: [{ id: node.id, value }],
      });
      return;
    }
    const size = Number(field('node-font').value);
    if (!node || !Number.isFinite(size) || size < 4 || size > 400) {
      inspect();
      return;
    }
    commit({
      type: 'graph',
      label: 'Text size',
      nodes: [{ id: node.id, value: { ...node, fontSize: size } }],
    });
  };
  inputElement('node-wrap').onchange = () => {
    const node = state.current.nodes.find((n) => n.id === state.selected);
    if (!node) return;
    const value = { ...node };
    if (inputElement('node-wrap').checked) value.wrap = true;
    else delete value.wrap;
    commit({
      type: 'graph',
      label: 'Caption wrapping',
      nodes: [{ id: node.id, value }],
    });
  };
  field('node-branch').onchange = () => {
    const node = state.current.nodes.find((n) => n.id === state.selected);
    const value = field('node-branch').value;
    if (!node) return;
    const journey: NonNullable<DiagramNode['journey']> = value.startsWith(
      'fixed:',
    )
      ? { mode: 'fixed', edge: value.slice(6) }
      : { mode: value === 'ask' ? 'ask' : 'all' };
    commit({
      type: 'graph',
      label: 'Journey branch',
      nodes: [{ id: node.id, value: { ...node, journey } }],
    });
  };
  field('node-color').onchange = () => {
    const node = state.current.nodes.find((n) => n.id === state.selected);
    const color = field('node-color').value;
    if (!node || !/^#[0-9a-f]{6}$/i.test(color) || color === node.color) return;
    commit({
      type: 'graph',
      label: 'Change colour',
      nodes: [{ id: node.id, value: { ...node, color } }],
    });
  };
  element('node-label').onchange = () => {
    const node = state.current.nodes.find((n) => n.id === state.selected);
    if (!node) return;
    const label = inputElement('node-label').value.slice(0, 1000);
    if (label === node.label) return;
    const service = findService(node.serviceId ?? node.label);
    commit({
      type: 'graph',
      label: 'Rename component',
      nodes: [
        {
          id: node.id,
          value: {
            ...node,
            label,
            ...(service ? { serviceId: service.id } : {}),
          },
        },
      ],
    });
  };
  element('detail-open').onclick = () => {
    const id = state.current.nodes.find(
      (n) => n.id === state.selected,
    )?.detailId;
    const board = state.project.details?.find(
      (entry) => entry.id === id,
    )?.document;
    if (board) navigateDiagram(board);
  };
  element('detail-create').onclick = () => {
    const node = state.current.nodes.find((n) => n.id === state.selected);
    if (!node) return;
    if ((state.project.details?.length ?? 0) >= 100) {
      notify('A project supports up to 100 detail diagrams');
      return;
    }
    const id = crypto.randomUUID();
    const board: DiagramDocument = {
      version: 1,
      title: `${node.label} detail`,
      nodes: [],
      edges: [],
    };
    state.history.execute({ type: 'detail', root: state.project, id, board });
    commit({
      type: 'graph',
      label: 'Link detail diagram',
      nodes: [{ id: node.id, value: { ...node, detailId: id } }],
    });
    navigateDiagram(board);
  };
  field('node-detail').onchange = () => {
    const node = state.current.nodes.find((n) => n.id === state.selected);
    if (!node) return;
    const value = { ...node };
    if (field('node-detail').value) value.detailId = field('node-detail').value;
    else delete value.detailId;
    commit({
      type: 'graph',
      label: 'Link detail diagram',
      nodes: [{ id: node.id, value }],
    });
  };
  field('node-caption').onchange = () => {
    const node = state.current.nodes.find((n) => n.id === state.selected);
    if (!node) return;
    commit({
      type: 'graph',
      label: 'Edit walkthrough caption',
      nodes: [
        {
          id: node.id,
          value: {
            ...node,
            journeyCaption: field('node-caption').value.slice(0, 1000),
          },
        },
      ],
    });
  };
  function updateRuleFields(): void {
    const disabled = field('rule-action').value !== 'allow';
    for (const id of [
      'rule-protocol',
      'rule-port',
      'rule-source',
      'rule-direction',
    ])
      field(id).disabled = disabled;
  }
  field('rule-action').onchange = updateRuleFields;
  element('rule-apply').onclick = () => {
    const edge = state.current.edges.find((e) => e.id === state.selectedEdge);
    if (!edge) return;
    try {
      const value = { ...edge };
      if (field('rule-action').value === 'none') delete value.networkRule;
      else if (field('rule-action').value === 'deny')
        value.networkRule = {
          action: 'deny',
          protocol: 'any',
          direction: 'any',
        };
      else
        value.networkRule = parseNetworkRule({
          action: field('rule-action').value,
          protocol: field('rule-protocol').value,
          direction: field('rule-direction').value,
          ...(field('rule-port').value
            ? { port: Number(field('rule-port').value) }
            : {}),
          ...(field('rule-source').value.trim()
            ? { sourceCidr: field('rule-source').value.trim() }
            : {}),
        });
      commit({
        type: 'graph',
        label: 'Change traffic rule',
        edges: [{ id: edge.id, value }],
      });
    } catch (error) {
      notify(String(error));
    }
  };
  for (const key of ['x', 'z', 'width', 'depth'] as const)
    field(`node-${key}`).onchange = () => {
      const node = state.current.nodes.find((n) => n.id === state.selected);
      if (!node) return;
      const value = Number(field(`node-${key}`).value);
      if (
        !Number.isFinite(value) ||
        Math.abs(value) > 1000000 ||
        ((key === 'width' || key === 'depth') && value < 30)
      ) {
        notify('Enter a valid size or coordinate.');
        inspect();
        return;
      }
      commit({
        type: 'graph',
        label: `Change ${key}`,
        nodes: [
          {
            id: node.id,
            value: {
              ...node,
              [key]: value,
              ...((node.kind === 'text' || node.kind === 'note') &&
              (key === 'width' || key === 'depth')
                ? {
                    fontSize: resizedFont(node, node, {
                      ...node,
                      [key]: value,
                    }),
                  }
                : {}),
            },
          },
        ],
      });
    };
  field('node-parent').onchange = () => {
    const node = state.current.nodes.find((n) => n.id === state.selected);
    if (!node) return;
    const index = new Map(state.current.nodes.map((n) => [n.id, n]));
    const world = worldPosition(node, index);
    const parent = field('node-parent').value;
    const target = index.get(parent);
    const p = target ? worldPosition(target, index) : { x: 0, z: 0 };
    const value = { ...node, x: world.x - p.x, z: world.z - p.z };
    delete value.parentId;
    if (parent) value.parentId = parent;
    commit({
      type: 'graph',
      label: 'Move into boundary',
      nodes: [{ id: node.id, value }],
    });
  };
  /** Nodes whose architecture details the panel edits: the whole selection. */
  function detailTargets(): DiagramNode[] {
    const ids = state.selectedIds.size
      ? state.selectedIds
      : new Set(state.selected ? [state.selected] : []);
    return state.current.nodes.filter((n) => ids.has(n.id));
  }
  /** Every node nested inside a boundary, at any depth. */
  function descendants(id: string): DiagramNode[] {
    const inside = new Set([id]);
    const result: DiagramNode[] = [];
    for (let changed = true; changed; ) {
      changed = false;
      for (const n of state.current.nodes)
        if (n.parentId && inside.has(n.parentId) && !inside.has(n.id)) {
          inside.add(n.id);
          result.push(n);
          changed = true;
        }
    }
    return result;
  }
  /** Set architecture details on several nodes in one undoable step. */
  function setDetails(
    nodes: readonly DiagramNode[],
    details: NonNullable<DiagramNode['metadata']>,
    label: string,
  ): void {
    if (!nodes.length) return;
    commit({
      type: 'graph',
      label,
      nodes: nodes.map((n) => ({
        id: n.id,
        value: { ...n, metadata: { ...n.metadata, ...details } },
      })),
    });
  }
  for (const key of METADATA_KEYS)
    field(`meta-${key}`).onchange = () => {
      const targets = detailTargets();
      setDetails(
        targets,
        { [key]: field(`meta-${key}`).value.slice(0, 1000) },
        targets.length > 1
          ? `Edit ${key} on ${targets.length} objects`
          : `Edit ${key}`,
      );
    };
  element('meta-apply-inside').onclick = () => {
    const boundary = state.current.nodes.find((n) => n.id === state.selected);
    if (!boundary) return;
    const details = Object.fromEntries(
      Object.entries(boundary.metadata ?? {}).filter(([, value]) => value),
    );
    const inside = descendants(boundary.id);
    if (!Object.keys(details).length) {
      notify('Fill in this boundary’s details first, then apply them.');
      return;
    }
    setDetails(inside, details, 'Apply details inside boundary');
    notify(
      `Details applied to ${inside.length} objects inside ${boundary.label}`,
    );
  };
  for (const key of [
    'label',
    'source',
    'target',
    'sourcePort',
    'targetPort',
    'routing',
    'bend',
  ] as const)
    field(`edge-${key}`).onchange = () => {
      const edge = state.current.edges.find((e) => e.id === state.selectedEdge);
      if (!edge) return;
      const value = { ...edge };
      const input = field(`edge-${key}`).value;
      if (key === 'bend') {
        const bend = Number(input);
        if (!Number.isFinite(bend) || Math.abs(bend) > 1000000) {
          inspect();
          return;
        }
        value.bend = bend;
      } else if (key === 'sourcePort' || key === 'targetPort') {
        if (input) value[key] = input as Port;
        else delete value[key];
      } else if (key === 'routing')
        value.routing = input as NonNullable<DiagramEdge['routing']>;
      else value[key] = input.slice(0, 1000);
      const id = edge.id;
      commit(
        { type: 'graph', label: 'Edit connection', edges: [{ id, value }] },
        [],
      );
      scene.selectEdge(id);
    };
  element('delete-edge').onclick = deleteSelection;
  /** Which route actions apply to the selected connection's fork. */
  function routeActions(): { active: boolean; all: boolean } {
    const edge = state.current.edges.find((e) => e.id === state.selectedEdge);
    if (!edge) return { active: false, all: false };
    const fork =
      state.current.edges.filter((e) => e.source === edge.source).length >= 2;
    const node = state.current.nodes.find((n) => n.id === edge.source);
    const fixed =
      node?.journey?.mode === 'fixed' ? node.journey.edge : undefined;
    return { active: fork && fixed !== edge.id, all: fork && !!fixed };
  }
  /** Choose the connection a fork follows; the other branches dim and go still. */
  function setRoute(active: boolean): void {
    const edge = state.current.edges.find((e) => e.id === state.selectedEdge);
    const node = edge && state.current.nodes.find((n) => n.id === edge.source);
    if (!edge || !node) return;
    const value = { ...node };
    if (active) value.journey = { mode: 'fixed', edge: edge.id };
    else delete value.journey;
    commit(
      {
        type: 'graph',
        label: active ? 'Set active route' : 'Show all routes',
        nodes: [{ id: node.id, value }],
      },
      [],
    );
    scene.selectEdge(edge.id);
    notify(
      active
        ? `Active route: ${node.label} ${branchName(state.current, edge.id)}`
        : `All routes from ${node.label} are active`,
    );
  }
  element('edge-active').onclick = () => setRoute(true);
  element('edge-all-routes').onclick = () => setRoute(false);

  return { inspect, routeActions };
}
