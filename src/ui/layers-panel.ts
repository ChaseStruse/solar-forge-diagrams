import type { App } from '../app/context';
import { findService } from '../catalog/services';
import type { DiagramNode } from '../domain/document';
import { element } from './dom';

export interface LayersPanel {
  showLayers(show: boolean): void;
  /** Rebuild the object tree when the board changed; restyle the selection. */
  updateLayers(): void;
}

/** The Layers panel: the object tree, connection list and diagram toggle. */
export function installLayersPanel(app: App): LayersPanel {
  const { state, scene, navigateDiagram } = app;
  function showLayers(show: boolean): void {
    state.layersVisible = show;
    element('layers-panel').hidden = !show;
    element('toggle-layers').setAttribute('aria-pressed', String(show));
    scene.setPanelVisible(show);
  }
  let layerSignature = '';
  const layerButtons = new Map<string, HTMLButtonElement>();
  function updateLayers(): void {
    const list = element('layer-tree');
    const signature = JSON.stringify([
      state.current.nodes.map((n) => [
        n.id,
        n.label,
        n.color,
        n.parentId,
        n.serviceId,
        n.kind,
        n.detailId,
      ]),
      state.current.edges.map((e) => [e.id, e.label, e.source, e.target]),
    ]);
    if (signature !== layerSignature) {
      layerSignature = signature;
      list.replaceChildren();
      layerButtons.clear();
      const names = new Map(
        state.current.nodes.map((node) => [node.id, node.label]),
      );
      const children = new Map<string | undefined, DiagramNode[]>();
      for (const node of state.current.nodes) {
        const entries = children.get(node.parentId) ?? [];
        entries.push(node);
        children.set(node.parentId, entries);
      }
      const ordered: { node: DiagramNode; depth: number }[] = [];
      const visit = (parent: string | undefined, depth: number) => {
        for (const node of children.get(parent) ?? []) {
          ordered.push({ node, depth });
          visit(node.id, depth + 1);
        }
      };
      visit(undefined, 0);
      for (const { node, depth } of ordered) {
        const button = document.createElement('button');
        button.className = `layer-row ${node.kind}${state.selectedIds.has(node.id) ? ' selected' : ''}`;
        button.setAttribute(
          'aria-pressed',
          String(state.selectedIds.has(node.id)),
        );
        const symbol = document.createElement('span');
        symbol.className = 'layer-symbol';
        symbol.style.color = node.color;
        const service = findService(node.serviceId ?? node.label);
        if (
          service?.icon &&
          (node.kind === 'service' || node.kind === 'group')
        ) {
          const image = document.createElement('img');
          image.src = service.icon;
          image.alt = '';
          symbol.append(image);
        } else
          symbol.textContent =
            node.kind === 'group' ? '▱' : (service?.glyph ?? '◇');
        if (node.kind === 'text' || node.kind === 'note') {
          symbol.textContent = node.kind === 'text' ? 'T' : '▤';
          symbol.style.color = node.kind === 'note' ? node.color : '';
        }
        const label = document.createElement('span');
        label.textContent =
          node.label.split('\n')[0] ||
          (node.kind === 'note'
            ? 'Sticky note'
            : node.kind === 'text'
              ? 'Text'
              : '');
        button.append(symbol, label);
        button.style.paddingLeft = `${8 + depth * 12}px`;
        layerButtons.set(`node:${node.id}`, button);
        button.onclick = (event) => scene.select(node.id, event.shiftKey);
        list.append(button);
        if (node.detailId) {
          const detail = state.project.details?.find(
            (entry) => entry.id === node.detailId,
          );
          if (detail) {
            const open = document.createElement('button');
            open.className = 'detail-layer-link';
            open.textContent = '↳ Open detail ↗';
            open.setAttribute('aria-label', `Open detail for ${node.label}`);
            open.onclick = () => navigateDiagram(detail.document);
            list.append(open);
          }
        }
      }
      if (state.current.edges.length) {
        const heading = document.createElement('p');
        heading.className = 'section-label connections-heading';
        heading.textContent = 'CONNECTIONS';
        list.append(heading);
      }
      for (const edge of state.current.edges) {
        const row = document.createElement('button');
        row.className = `layer-row connection-row${state.selectedEdge === edge.id ? ' selected' : ''}`;
        row.textContent = `↳ ${edge.label || 'Connection'} · ${names.get(edge.source) ?? ''} → ${names.get(edge.target) ?? ''}`;
        row.onclick = () => scene.selectEdge(edge.id);
        list.append(row);
        layerButtons.set(`edge:${edge.id}`, row);
      }
    }
    for (const [key, button] of layerButtons) {
      const active = key.startsWith('node:')
        ? state.selectedIds.has(key.slice(5))
        : state.selectedEdge === key.slice(5);
      button.classList.toggle('selected', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }
  element('toggle-layers').onclick = () => showLayers(!state.layersVisible);
  element('close-layers').onclick = () => showLayers(false);
  element('ground-toggle').onclick = () => {
    state.diagramVisible = !state.diagramVisible;
    scene.setDiagramVisible(state.diagramVisible);
    element('ground-toggle').setAttribute(
      'aria-pressed',
      String(state.diagramVisible),
    );
    element('ground-toggle').setAttribute(
      'aria-label',
      state.diagramVisible ? 'Hide diagram' : 'Show diagram',
    );
  };
  function adaptViewport(): void {
    if (innerWidth < 800 && state.layersVisible) showLayers(false);
  }
  window.addEventListener('resize', adaptViewport);
  adaptViewport();
  return { showLayers, updateLayers };
}
