/** Typed lookups for elements the application shell is known to contain. */
export function element(id: string): HTMLElement {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing element: ${id}`);
  return result;
}

export function inputElement(id: string): HTMLInputElement {
  const result = element(id);
  if (!(result instanceof HTMLInputElement))
    throw new Error(`Expected input: ${id}`);
  return result;
}

export function field(
  id: string,
): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  const value = element(id);
  if (
    value instanceof HTMLInputElement ||
    value instanceof HTMLSelectElement ||
    value instanceof HTMLTextAreaElement
  )
    return value;
  throw Error(`Expected field ${id}`);
}

/** Whether keystrokes aimed at this target are typing rather than shortcuts. */
export function isTextTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/** Replace a select's options and choose `value`. */
export function fillOptions(
  id: string,
  options: readonly (readonly [string, string])[],
  value: string,
): void {
  const select = field(id);
  if (!(select instanceof HTMLSelectElement)) return;
  select.replaceChildren(
    ...options.map(([id, label]) => {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = label;
      return option;
    }),
  );
  select.value = value;
}

/**
 * A modal workspace panel built from `html`. While open, the rest of the app
 * is inert. Its × button (`data-close`) and Escape call `onClose`, which
 * closes the panel unless the owner replaces it.
 */
export function workspaceDialog(
  className: string,
  label: string,
  html: string,
) {
  const panel = document.createElement('section');
  panel.className = className;
  panel.hidden = true;
  panel.setAttribute('aria-label', label);
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.innerHTML = html;
  document.body.append(panel);
  const app = document.getElementById('app');
  const setOpen = (open: boolean) => {
    panel.hidden = !open;
    if (app) app.inert = open;
  };
  const dialog = {
    panel,
    find<T extends HTMLElement>(selector: string): T {
      const found = panel.querySelector<T>(selector);
      if (!found) throw Error(`Missing ${label} control: ${selector}`);
      return found;
    },
    open: () => setOpen(true),
    close: () => setOpen(false),
    onClose: () => dialog.close(),
  };
  dialog.find('[data-close]').onclick = () => dialog.onClose();
  panel.addEventListener('keydown', (e) => {
    // Keys typed here never reach the board's shortcuts.
    e.stopPropagation();
    if (e.key === 'Escape') dialog.onClose();
  });
  return dialog;
}
