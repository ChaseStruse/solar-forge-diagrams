import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { DiagramEdge, DiagramNode } from '../domain/document';
import { parseDocument, serializeDocument } from '../domain/document';
import { layoutEdit } from '../domain/layout';
import { RecoveryWriter } from '../persistence/recovery';
import {
  copyPng,
  exportPng,
  exportText,
  nativeAvailable,
  type OpenedFile,
  openDocumentFile,
  readRecovery,
  saveDocumentFile,
  saveSvg,
  writeRecovery,
} from '../platform/files';
import { choose, promptText } from '../ui/dialogs';
import { element } from '../ui/dom';
import { infrastructureImporter } from '../ui/importer';
import type { App } from './context';

export interface FileCommands {
  /** Ask to save unsaved changes; false when the user cancels. */
  canReplace(): Promise<boolean>;
  copyImage(): Promise<void>;
  /** Queue a crash-recovery snapshot once startup recovery is settled. */
  scheduleRecovery(): void;
  /**
   * Startup: offer a crash-recovery snapshot, guard window close, load recent
   * files and open a file passed on the command line.
   */
  start(): Promise<void>;
}

/**
 * The document lifecycle: new, open, recent files, save, examples, imports,
 * exports, crash recovery and closing the window.
 */
export function installFileCommands(
  app: App,
  boardFontFamily: () => string | undefined,
): FileCommands {
  const {
    state,
    scene,
    notify,
    commit,
    action,
    replaceDocument,
    updateHeader,
  } = app;
  const recovery = new RecoveryWriter(
    () => (state.history.isDirty ? serializeDocument(state.project) : null),
    writeRecovery,
    (error) => notify(`Recovery failed: ${String(error)}. Save your diagram.`),
  );
  async function refreshRecents(): Promise<void> {
    if (!nativeAvailable()) return;
    try {
      const files =
        await invoke<{ name: string; path: string }[]>('recent_documents');
      const list = element('recent-files');
      list.replaceChildren();
      if (!files.length) {
        const empty = document.createElement('p');
        empty.className = 'muted';
        empty.textContent = 'No recent diagrams yet';
        list.append(empty);
      }
      for (const file of files) {
        const button = document.createElement('button');
        button.textContent = file.name;
        button.title = file.path;
        button.onclick = () =>
          void action(async () => {
            if (!(await canReplace())) return;
            const opened = await invoke<OpenedFile>('open_recent', {
              path: file.path,
            });
            replaceDocument(parseDocument(opened.content));
            state.fileHandle = opened.handle;
            element('file-menu').hidden = true;
            notify(`Opened ${opened.name}`);
            await refreshRecents();
          });
        list.append(button);
      }
    } catch (error) {
      notify(`Recent files unavailable: ${String(error)}`);
    }
  }
  element('title').onclick = () =>
    void action(async () => {
      const title = await promptText('Diagram name', state.current.title);
      if (title) commit({ type: 'graph', label: 'Rename diagram', title });
    });
  for (const id of ['examples', 'browse-examples']) {
    element(id).onclick = () =>
      void action(async () => {
        element('file-menu').hidden = true;
        element('menu').setAttribute('aria-expanded', 'false');
        const { chooseExample } = await import('../ui/examples');
        const template = await chooseExample();
        if (!template || !(await canReplace())) return;
        replaceDocument(template.create());
        notify(`Loaded ${template.name}`);
      });
  }
  element('export-svg').onclick = () =>
    void action(async () => {
      const { exportSvg } = await import('../export/svg');
      if (await saveSvg(await exportSvg(state.current, boardFontFamily())))
        notify('SVG exported');
    });
  for (const [id, format] of [
    ['export-mermaid', 'mmd'],
    ['export-plantuml', 'puml'],
    ['export-drawio', 'drawio'],
  ] as const) {
    element(id).onclick = () =>
      void action(async () => {
        const { exportInterchange } = await import('../export/interchange');
        const content = exportInterchange(
          format === 'drawio' ? state.project : state.current,
          format,
        );
        if (await exportText(content, format))
          notify(
            `Exported ${format === 'drawio' ? 'draw.io project' : 'diagram source'}`,
          );
        element('file-menu').hidden = true;
      });
  }
  async function saveCurrent(saveAs = false): Promise<boolean> {
    scene.finishInteraction();
    const savedHistory = state.history;
    const token = state.history.token;
    const saved = await saveDocumentFile(
      serializeDocument(state.project),
      saveAs ? undefined : state.fileHandle,
      state.project.title,
    );
    if (!saved) return false;
    if (state.history === savedHistory) state.fileHandle = saved.handle;
    savedHistory.markSaved(token);
    updateHeader();
    await recovery.flush();
    notify(`Saved ${saved.name}`);
    void refreshRecents();
    return !state.history.isDirty;
  }
  async function canReplace(): Promise<boolean> {
    scene.finishInteraction();
    if (!state.history.isDirty) return true;
    const decision = await choose(
      'Save your changes?',
      'This diagram has unsaved changes.',
      ['Cancel', 'Discard changes', 'Save'],
    );
    if (decision === 'Save') return saveCurrent();
    return decision === 'Discard changes';
  }
  const importer = infrastructureImporter({
    notify,
    apply: async (doc) => {
      const nodeChanges = new Map(
        state.current.nodes.map((node) => [
          node.id,
          { id: node.id, value: null as DiagramNode | null },
        ]),
      );
      for (const value of doc.nodes)
        nodeChanges.set(value.id, { id: value.id, value });
      const edgeChanges = new Map(
        state.current.edges.map((edge) => [
          edge.id,
          { id: edge.id, value: null as DiagramEdge | null },
        ]),
      );
      for (const value of doc.edges)
        edgeChanges.set(value.id, { id: value.id, value });
      commit(
        {
          type: 'graph',
          label: 'Import diagram',
          title: doc.title,
          nodes: [...nodeChanges.values()],
          edges: [...edgeChanges.values()],
        },
        [],
      );
      scene.fit();
      return true;
    },
  });
  element('import-infrastructure').onclick = () => {
    element('file-menu').hidden = true;
    importer.open();
  };
  element('auto-layout').onclick = () => {
    commit(layoutEdit(state.current));
    scene.fit();
    element('file-menu').hidden = true;
  };
  element('new').onclick = () =>
    void action(async () => {
      if (!(await canReplace())) return;
      replaceDocument({
        version: 1,
        title: 'Untitled diagram',
        nodes: [],
        edges: [],
      });
      element('file-menu').hidden = true;
    });
  element('open').onclick = () => {
    element('file-menu').hidden = true;
    void action(async () => {
      if (!(await canReplace())) return;
      const opened = await openDocumentFile();
      if (opened !== null) {
        replaceDocument(parseDocument(opened.content));
        state.fileHandle = opened.handle;
        notify(`Opened ${opened.name}`);
        void refreshRecents();
      }
    });
  };
  for (const id of ['save', 'save-as'])
    element(id).onclick = () => {
      element('file-menu').hidden = true;
      void action(async () => {
        await saveCurrent(id === 'save-as');
      });
    };
  element('export').onclick = () => {
    element('file-menu').hidden = true;
    void action(async () => {
      if (await exportPng(await scene.png())) notify('PNG exported');
    });
  };
  element('quick-save').onclick = () => element('save').click();
  async function copyImage(): Promise<void> {
    try {
      notify('Capturing diagram…');
      await copyPng(await scene.captureDiagram());
      notify('Diagram image copied · paste it anywhere');
    } catch (error) {
      notify(
        `Could not copy image: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  element('copy-image').onclick = () => void copyImage();
  element('quick-export').onclick = () => element('export').click();
  async function start(): Promise<void> {
    const native = nativeAvailable();
    if (native) {
      if (await invoke<boolean>('diagnostic_mode')) {
        const { runNativeDiagnostics } = await import(
          '../renderer/diagnostics'
        );
        await runNativeDiagnostics(scene);
        return;
      }
      let closing = false;
      await getCurrentWindow().onCloseRequested((event) => {
        event.preventDefault();
        if (closing || state.busy) return;
        closing = true;
        void (async () => {
          if (!(await canReplace())) return;
          // A deliberate discard also removes the recovery snapshot.
          if (state.recoveryReady) {
            await recovery.flush();
            await writeRecovery(null);
          }
          recovery.dispose();
          await getCurrentWindow().destroy();
        })()
          .catch((error) => notify(`Could not close: ${String(error)}`))
          .finally(() => {
            closing = false;
          });
      });
    }
    const content = await readRecovery();
    if (content) {
      const decision = await choose(
        'Recover your diagram?',
        'An unsaved diagram was found from a previous session.',
        native
          ? ['Close app', 'Discard recovery', 'Recover']
          : ['Discard recovery', 'Recover'],
      );
      if (decision === 'Recover') {
        replaceDocument(parseDocument(content));
        state.history.markSaved(-1);
        updateHeader();
        notify('Recovered diagram. Save to choose a destination.');
      } else if (decision === 'Discard recovery') await writeRecovery(null);
      else if (native) {
        await getCurrentWindow().destroy();
        return;
      }
    }
    state.recoveryReady = true;
    window.addEventListener('blur', () => {
      if (state.history.isDirty) {
        recovery.schedule();
        void recovery.flush().catch(() => {});
      }
    });
    if (!native) return;
    await refreshRecents();
    const openPending = async () => {
      if (state.busy) return;
      const opened = await invoke<OpenedFile | null>('take_pending_file');
      if (!opened) return;
      await action(async () => {
        if (!(await canReplace())) return;
        replaceDocument(parseDocument(opened.content));
        state.fileHandle = opened.handle;
        notify(`Opened ${opened.name}`);
        await refreshRecents();
      });
    };
    await listen(
      'pending-file',
      () => void openPending().catch((error) => notify(String(error))),
    );
    await openPending();
  }

  return {
    canReplace,
    copyImage,
    scheduleRecovery: () => {
      if (state.recoveryReady) recovery.schedule();
    },
    start,
  };
}
