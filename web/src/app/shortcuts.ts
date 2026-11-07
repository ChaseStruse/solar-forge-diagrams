import { services } from '../catalog/services';
import type { DiagramNode } from '../domain/document';
import { parseDocument, serializeDocument } from '../domain/document';
import { CameraKeys, isPanKey } from '../editor/camera-keys';
import {
  type Alignment,
  copyFragment,
  pasteFragment,
} from '../editor/operations';
import { themes } from '../themes';
import { commandPalette } from '../ui/dialogs';
import { element, inputElement, isTextTarget } from '../ui/dom';
import type { App } from './context';

/** Commands from other modules that keys and the command palette run. */
export interface ShortcutCommands {
  setTheme(id: string): void;
  copyImage(): Promise<void>;
  populateComponents(query: string): void;
  align(alignment: Alignment): void;
  alignments: readonly [Alignment, string][];
  closeSettings(): void;
  toggleLanes(): void;
  swapLaneDirection(): void;
}

/**
 * Keyboard shortcuts, the Ctrl+K command palette, clipboard copy, cut and
 * paste, WASD camera keys, and closing the context menu on outside clicks.
 */
export function installShortcuts(app: App, commands: ShortcutCommands): void {
  const {
    state,
    scene,
    notify,
    commit,
    selectTool,
    showComponents,
    travelHistory,
    deleteSelection,
    openEditor,
    closeEditor,
    toggleJourney,
  } = app;
  const { setTheme, align, alignments } = commands;
  const cameraKeys = new CameraKeys((dx, dy) => scene.panByPixels(dx, dy));
  function hasSelectedAncestor(node: DiagramNode): boolean {
    let parent = node.parentId;
    while (parent) {
      if (state.selectedIds.has(parent)) return true;
      parent = state.current.nodes.find((n) => n.id === parent)?.parentId;
    }
    return false;
  }
  window.addEventListener('pointerdown', (event) => {
    if (
      event.target instanceof Node &&
      !element('context-menu').contains(event.target)
    )
      element('context-menu').hidden = true;
  });
  for (const type of ['copy', 'cut'] as const)
    window.addEventListener(type, (event) => {
      if (isTextTarget(event.target) || !state.selectedIds.size) return;
      event.preventDefault();
      event.clipboardData?.setData(
        'text/plain',
        serializeDocument(copyFragment(state.current, state.selectedIds)),
      );
      if (type === 'cut') deleteSelection();
    });
  window.addEventListener('paste', (event) => {
    if (isTextTarget(event.target)) return;
    const text = event.clipboardData?.getData('text/plain');
    if (!text) return;
    try {
      const doc = parseDocument(text);
      const edit = pasteFragment(doc, () => crypto.randomUUID());
      event.preventDefault();
      commit(
        edit,
        edit.type === 'graph' ? (edit.nodes?.map((n) => n.id) ?? []) : [],
      );
    } catch {
      notify('Clipboard does not contain a valid Solar Forge selection.');
    }
  });
  window.addEventListener('keydown', (event) => {
    if (isTextTarget(event.target)) return;
    if (
      (event.ctrlKey || event.metaKey) &&
      ['a', 'g', 'd'].includes(event.key.toLowerCase())
    ) {
      event.preventDefault();
      const key = event.key.toLowerCase();
      if (key === 'a') scene.selectMany(state.current.nodes.map((n) => n.id));
      else
        element(
          key === 'd' ? 'duplicate' : event.shiftKey ? 'ungroup' : 'tool-group',
        ).click();
    }
  });

  window.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      commandPalette([
        ...[
          'new',
          'browse-examples',
          'open',
          'save',
          'save-as',
          'export',
          'export-svg',
          'auto-layout',
          'reachability',
          'import-infrastructure',
          'export-gif',
          'export-video',
          'export-mermaid',
          'export-plantuml',
          'export-drawio',
          'fit',
          'iso',
          'top',
          'tool-group',
          'ungroup',
          'duplicate',
          'delete',
        ].map((id) => ({
          label:
            element(id).getAttribute('title') ??
            element(id).textContent?.trim() ??
            id,
          run: () => element(id).click(),
        })),
        { label: 'Play journey (P)', run: toggleJourney },
        { label: 'Lanes: show or hide (L)', run: commands.toggleLanes },
        {
          label: 'Lanes: switch rows and columns',
          run: commands.swapLaneDirection,
        },
        {
          label: 'Copy diagram image (Ctrl+Shift+C)',
          run: () => void commands.copyImage(),
        },
        ...alignments.map(([alignment, label]) => ({
          label,
          run: () => align(alignment),
        })),
        ...themes.map((option) => ({
          label: `Theme: ${option.name}`,
          run: () => setTheme(option.id),
        })),
        ...services.map((service) => ({
          label: `Add ${service.label} · ${service.category}`,
          run: () => {
            showComponents(true);
            inputElement('search').value = service.label;
            commands.populateComponents(service.label);
          },
        })),
      ]);
      return;
    }
    if (
      (event.ctrlKey || event.metaKey) &&
      ['z', 'y'].includes(event.key.toLowerCase()) &&
      !(event.target instanceof HTMLInputElement) &&
      !(event.target instanceof HTMLTextAreaElement)
    ) {
      event.preventDefault();
      travelHistory(event.shiftKey || event.key.toLowerCase() === 'y');
      return;
    }
    if (
      (event.ctrlKey || event.metaKey) &&
      event.shiftKey &&
      event.key.toLowerCase() === 'c' &&
      !isTextTarget(event.target)
    ) {
      event.preventDefault();
      void commands.copyImage();
      return;
    }
    if (
      (event.ctrlKey || event.metaKey) &&
      ['s', 'o', 'n'].includes(event.key.toLowerCase())
    ) {
      event.preventDefault();
      element(
        event.key.toLowerCase() === 's'
          ? event.shiftKey
            ? 'save-as'
            : 'save'
          : event.key.toLowerCase() === 'n'
            ? 'new'
            : 'open',
      ).click();
      return;
    }
    if (event.key === 'Escape') {
      closeEditor?.(false);
      if (scene.journeyPlaying) {
        scene.stopJourney();
        return;
      }
      scene.cancelInteraction();
      element('context-menu').hidden = true;
      selectTool('select');
      showComponents(false);
      element('file-menu').hidden = true;
      element('help-panel').hidden = true;
      element('traffic-panel').hidden = true;
      element('gif-panel').hidden = true;
      element('theme-menu').hidden = true;
      commands.closeSettings();
      element('menu').setAttribute('aria-expanded', 'false');
      element('help').setAttribute('aria-expanded', 'false');
      scene.select(undefined);
      return;
    }
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement ||
      event.target instanceof HTMLSelectElement ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    )
      return;
    const roots = state.current.nodes.filter(
      (n) => state.selectedIds.has(n.id) && !hasSelectedAncestor(n),
    );
    const arrow = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(
      event.key,
    );
    // Arrows nudge a selection; otherwise they and WASD glide the camera.
    if (
      isPanKey(event.key) &&
      !(arrow && roots.length) &&
      // A modal dialog owns the keyboard; the board behind it stays put.
      !document.querySelector('dialog[open]')
    ) {
      event.preventDefault();
      cameraKeys.press(event.key, event.shiftKey);
      return;
    }
    if (arrow) {
      event.preventDefault();
      const step = event.shiftKey ? 50 : scene.snapping ? 10 : 1;
      const dx =
        event.key === 'ArrowLeft'
          ? -step
          : event.key === 'ArrowRight'
            ? step
            : 0;
      const dz =
        event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
      commit({
        type: 'graph',
        label: 'Nudge selection',
        nodes: roots.map((n) => ({
          id: n.id,
          value: { ...n, x: n.x + dx, z: n.z + dz },
        })),
      });
    }
    if (event.key === '/') {
      event.preventDefault();
      showComponents(true);
    }
    if (event.key.toLowerCase() === 'v') selectTool('select');
    if (event.key.toLowerCase() === 'c') element('tool-connect').click();
    if (event.key.toLowerCase() === 'm') selectTool('pan');
    if (event.key.toLowerCase() === 'p') toggleJourney();
    if (event.key.toLowerCase() === 'l') commands.toggleLanes();
    if (event.key.toLowerCase() === 't') element('tool-text').click();
    if (event.key.toLowerCase() === 'n') element('tool-note').click();
    if (event.key.toLowerCase() === 'b') element('tool-sketch').click();
    if (event.key === 'Enter' && state.selected) {
      event.preventDefault();
      openEditor({ kind: 'node', id: state.selected });
    }
    if (event.key.toLowerCase() === 'f') scene.fit();
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      deleteSelection();
    }
  });
  window.addEventListener('keyup', (event) => {
    if (isPanKey(event.key)) cameraKeys.release(event.key, event.shiftKey);
  });
  window.addEventListener('blur', () => cameraKeys.stop());
}
