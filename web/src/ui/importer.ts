import type { DiagramDocument } from '../domain/document';
import { importInWorker } from '../import/client';
import type { ImportFormat } from '../import/infrastructure';
import { looksLikeMermaid } from '../import/mermaid';
import type { ImportResult, InfrastructureFile } from '../import/types';
import {
  openInfrastructureFiles,
  openInfrastructureFolder,
} from '../platform/files';

export function infrastructureImporter(host: {
  apply: (doc: DiagramDocument) => Promise<boolean>;
  notify: (message: string) => void;
}): { open: () => void; close: () => void } {
  const panel = document.createElement('section');
  panel.className = 'workspace-dialog';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Import a diagram');
  panel.innerHTML = `<div class="dialog-heading"><h2>Import</h2><button data-close aria-label="Close import">×</button></div><p>Choose a Mermaid flowchart, state or architecture diagram, .tf files together (or a Terraform folder, to include its local modules and .tfvars), or a Terraform JSON, CloudFormation, or Compose file. Files stay on this computer; code is never executed.</p><label>Format<select data-format><option value="auto">Detect format</option><option value="terraform">Terraform HCL / show JSON</option><option value="cloudformation">CloudFormation YAML / JSON</option><option value="compose">Docker Compose</option><option value="mermaid">Mermaid chart</option></select></label><label class="check"><input type="checkbox" data-lanes> Mermaid subgraphs become swimlanes</label><button data-files>Choose files…</button> <button data-folder>Choose Terraform folder…</button><p data-names>No files selected</p><label>Or paste Mermaid or infrastructure code<textarea data-source rows="9" spellcheck="false" placeholder="Paste a Mermaid chart or infrastructure code; use Format to select Terraform for pasted HCL"></textarea></label><button data-preview>Preview import</button><div data-summary role="status"></div><ul data-warnings></ul><div class="dialog-actions"><button data-apply disabled>Import diagram</button></div>`;
  document.body.append(panel);
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  const app = document.getElementById('app');
  const find = <T extends HTMLElement>(selector: string) => {
    const element = panel.querySelector<T>(selector);
    if (!element) throw Error('Missing importer control');
    return element;
  };
  const source = find<HTMLTextAreaElement>('[data-source]'),
    format = find<HTMLSelectElement>('[data-format]'),
    apply = find<HTMLButtonElement>('[data-apply]'),
    summary = find('[data-summary]'),
    warnings = find('[data-warnings]'),
    lanes = find<HTMLInputElement>('[data-lanes]');
  let files: InfrastructureFile[] = [],
    preview: ImportResult | undefined,
    busy = false;
  let pending: AbortController | undefined;
  let revision = 0;
  const invalidate = () => {
    revision++;
    pending?.abort();
    pending = undefined;
    find<HTMLButtonElement>('[data-preview]').disabled = false;
    preview = undefined;
    apply.disabled = true;
    summary.textContent = '';
    warnings.replaceChildren();
  };
  const showError = (e: unknown) => {
    summary.textContent = String(e);
    host.notify(String(e));
  };
  source.oninput = () => {
    files = [];
    find('[data-names]').textContent = 'Pasted code';
    invalidate();
  };
  format.onchange = invalidate;
  lanes.onchange = invalidate;
  const prepare = async () => {
    if (busy) return;
    invalidate();
    const controller = new AbortController();
    pending = controller;
    const request = revision;
    find<HTMLButtonElement>('[data-preview]').disabled = true;
    summary.textContent = 'Reading infrastructure…';
    try {
      const chosen = source.value.trim()
        ? [
            {
              name:
                format.value === 'mermaid' ||
                (format.value === 'auto' && looksLikeMermaid(source.value))
                  ? 'pasted.mmd'
                  : (format.value === 'terraform' ||
                        (format.value === 'auto' &&
                          /^\s*(resource|provider|variable|terraform|locals)\b/m.test(
                            source.value,
                          ))) &&
                      !source.value.trimStart().startsWith('{')
                    ? 'pasted.tf'
                    : 'pasted.yaml',
              content: source.value,
            },
          ]
        : files;
      const result = await importInWorker(
        chosen,
        format.value as ImportFormat,
        controller.signal,
        { subgraphLanes: lanes.checked },
      );
      if (controller.signal.aborted || request !== revision) return;
      preview = result;
      const flowchart = preview.format.startsWith('Mermaid');
      const shapes = preview.document.nodes.filter(
        (n) => n.kind !== 'group',
      ).length;
      const groups = preview.document.nodes.length - shapes;
      summary.textContent = `${preview.format} · ${shapes} ${flowchart ? 'shapes' : 'resources'} · ${groups} ${flowchart ? 'groups' : 'boundaries'} · ${flowchart ? `${preview.document.edges.length} connections · ` : ''}${preview.warnings.length} warnings. Import replaces the current board with an automatically laid out diagram; Undo restores it.`;
      for (const message of preview.warnings.slice(0, 200)) {
        const li = document.createElement('li');
        li.textContent = message;
        warnings.append(li);
      }
      if (preview.warnings.length > 200) {
        const li = document.createElement('li');
        li.textContent = 'Additional warnings omitted from this preview.';
        warnings.append(li);
      }
      apply.disabled = false;
    } catch (e) {
      if (!controller.signal.aborted && request === revision) showError(e);
    } finally {
      if (pending === controller) {
        pending = undefined;
        find<HTMLButtonElement>('[data-preview]').disabled = false;
      }
    }
  };
  const choose = (open: () => Promise<InfrastructureFile[]>) => () => {
    if (busy) return;
    void (async () => {
      try {
        const chosen = await open();
        if (!chosen.length) return;
        files = chosen;
        source.value = '';
        find('[data-names]').textContent = files.map((f) => f.name).join(', ');
        await prepare();
      } catch (e) {
        showError(e);
      }
    })();
  };
  find('[data-files]').onclick = choose(openInfrastructureFiles);
  find('[data-folder]').onclick = choose(async () => {
    const chosen = await openInfrastructureFolder();
    if (!chosen.length) host.notify('No .tf or .tfvars files in that folder');
    else format.value = 'terraform';
    return chosen;
  });
  find('[data-preview]').onclick = () => void prepare();
  apply.onclick = () => {
    if (!preview || busy) return;
    busy = true;
    void host
      .apply(preview.document)
      .then((applied) => {
        if (applied) {
          panel.hidden = true;
          if (app) app.inert = false;
        }
      })
      .catch(showError)
      .finally(() => {
        busy = false;
      });
  };
  const close = () => {
    if (!busy) {
      invalidate();
      panel.hidden = true;
      if (app) app.inert = false;
    }
  };
  find('[data-close]').onclick = close;
  panel.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  });
  return {
    open: () => {
      panel.hidden = false;
      if (app) app.inert = true;
      format.focus();
    },
    close,
  };
}
