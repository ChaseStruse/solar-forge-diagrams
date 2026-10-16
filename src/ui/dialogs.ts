/** Accessible modal actions with explicit cancel semantics, including Escape. */
export function choose(
  title: string,
  message: string,
  actions: readonly string[],
): Promise<string | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'decision-dialog';
    const heading = document.createElement('h2');
    heading.textContent = title;
    heading.id = 'dialog-title';
    const text = document.createElement('p');
    text.textContent = message;
    const buttons = document.createElement('div');
    buttons.className = 'dialog-actions';
    for (const action of actions) {
      const button = document.createElement('button');
      button.textContent = action;
      button.onclick = () => dialog.close(action);
      buttons.append(button);
    }
    dialog.append(heading, text, buttons);
    dialog.setAttribute('aria-labelledby', heading.id);
    dialog.addEventListener(
      'close',
      () => {
        resolve(dialog.returnValue || null);
        dialog.remove();
      },
      { once: true },
    );
    document.body.append(dialog);
    dialog.showModal();
  });
}
