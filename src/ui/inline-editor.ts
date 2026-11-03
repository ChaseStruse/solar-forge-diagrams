import type { App } from '../app/context';
import { MAX_TEXT } from '../domain/document';
import { fontSize } from '../domain/text';
import type { EditTarget } from '../renderer/scene';

export interface InlineEditor {
  open(target: EditTarget, created?: boolean): void;
  /** Finish the open edit, if any: keep or discard what was typed. */
  close(save: boolean): void;
}

/**
 * Edit text in place over the canvas. Annotations get a multi-line editor
 * matching their box; services, boundaries and connections a one-line field.
 */
export function installInlineEditor(
  app: App,
  placeText: (x: number, z: number) => void,
): InlineEditor {
  const { state, scene, notify, commit, travelHistory } = app;
  let closeEditor: ((save: boolean) => void) | undefined;
  /**
   * Edit text in place over the canvas. Annotations get a multi-line editor
   * matching their box; services, boundaries and connections a one-line field.
   */
  function openEditor(target: EditTarget, created = false): void {
    closeEditor?.(true);
    if (target.kind === 'empty') {
      placeText(target.x, target.z);
      return;
    }
    const node =
      target.kind === 'node'
        ? state.current.nodes.find((n) => n.id === target.id)
        : undefined;
    const edge =
      target.kind === 'edge'
        ? state.current.edges.find((e) => e.id === target.id)
        : undefined;
    if (!node && !edge) return;
    const annotation = node?.kind === 'text' || node?.kind === 'note';
    const editor = document.createElement(annotation ? 'textarea' : 'input');
    editor.className = `inline-editor${node ? ` ${node.kind}` : ' edge'}`;
    editor.value = node?.label ?? edge?.label ?? '';
    editor.maxLength = annotation ? MAX_TEXT : 1000;
    editor.setAttribute('aria-label', annotation ? 'Text' : 'Label');
    editor.spellcheck = annotation;
    if (node && annotation) {
      const rect = scene.nodeScreenRect(node.id);
      const scale = scene.nodePixelScale(node.id);
      if (!rect) return;
      Object.assign(editor.style, {
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${Math.max(rect.width, 160)}px`,
        height: `${Math.max(rect.height, 48)}px`,
        fontSize: `${Math.max(11, fontSize(node) * scale)}px`,
        padding: `${(node.kind === 'note' ? 14 : 4) * scale}px`,
        background: node.kind === 'note' ? node.color : '',
      });
    } else {
      const anchor = node
        ? (() => {
            const rect = scene.nodeScreenRect(node.id);
            return rect
              ? {
                  x: rect.left + rect.width / 2,
                  y:
                    node.kind === 'group'
                      ? rect.top + 18
                      : rect.top + rect.height + 22,
                }
              : undefined;
          })()
        : edge
          ? scene.edgeScreenPosition(edge.id)
          : undefined;
      if (!anchor) return;
      Object.assign(editor.style, {
        left: `${anchor.x - 110}px`,
        top: `${anchor.y - 18}px`,
        width: '220px',
      });
    }
    document.body.append(editor);
    editor.focus();
    editor.select();
    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      closeEditor = undefined;
      const value = editor.value;
      editor.remove();
      if (!save) {
        // Cancelling a just-placed annotation removes it again.
        if (created && annotation) travelHistory(false);
        return;
      }
      if (node) {
        const live = state.current.nodes.find((n) => n.id === node.id);
        if (!live) return;
        if (created && live.kind === 'text' && !value.trim()) {
          travelHistory(false);
          return;
        }
        if (value === live.label) return;
        commit(
          {
            type: 'graph',
            label: annotation ? 'Edit text' : 'Rename component',
            nodes: [{ id: live.id, value: { ...live, label: value } }],
          },
          [live.id],
        );
      } else if (edge) {
        const live = state.current.edges.find((e) => e.id === edge.id);
        if (!live || value === live.label) return;
        commit(
          {
            type: 'graph',
            label: 'Label connection',
            edges: [
              { id: live.id, value: { ...live, label: value.slice(0, 1000) } },
            ],
          },
          [],
        );
        scene.selectEdge(live.id);
      }
    };
    closeEditor = finish;
    editor.addEventListener('blur', () => finish(true));
    editor.addEventListener('keydown', (event) => {
      const keyboard = event as KeyboardEvent;
      keyboard.stopPropagation();
      if (keyboard.key === 'Escape') {
        keyboard.preventDefault();
        finish(!created);
      } else if (
        keyboard.key === 'Enter' &&
        (!annotation || keyboard.ctrlKey || keyboard.metaKey)
      ) {
        keyboard.preventDefault();
        finish(true);
      }
    });
    notify(
      annotation
        ? 'Typing · Ctrl+Enter or click away to finish · Esc cancels'
        : 'Enter to rename · Esc cancels',
    );
  }
  // The canvas claims pointerdown (no blur), so finish inline edits explicitly.
  window.addEventListener(
    'pointerdown',
    (event) => {
      if (
        closeEditor &&
        !(
          event.target instanceof Element &&
          event.target.closest('.inline-editor')
        )
      )
        closeEditor(true);
    },
    { capture: true },
  );

  return {
    open: openEditor,
    close: (save) => closeEditor?.(save),
  };
}
