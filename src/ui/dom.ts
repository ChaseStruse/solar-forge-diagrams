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
