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

export function promptText(
  title: string,
  value: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'decision-dialog';
    const heading = document.createElement('h2');
    heading.textContent = title;
    const form = document.createElement('form');
    form.method = 'dialog';
    const input = document.createElement('input');
    input.value = value;
    input.maxLength = 1000;
    input.setAttribute('aria-label', title);
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.type = 'button';
    cancel.onclick = () => dialog.close();
    const save = document.createElement('button');
    save.textContent = 'Rename';
    save.type = 'submit';
    const actions = document.createElement('div');
    actions.className = 'dialog-actions';
    actions.append(cancel, save);
    form.append(input, actions);
    form.onsubmit = () => {
      dialog.returnValue = input.value;
    };
    dialog.append(heading, form);
    document.body.append(dialog);
    dialog.onclose = () => {
      resolve(dialog.returnValue || null);
      dialog.remove();
    };
    dialog.showModal();
    input.focus();
    input.select();
  });
}
export function commandPalette(
  commands: readonly { label: string; run: () => void }[],
): void {
  const dialog = document.createElement('dialog');
  dialog.className = 'decision-dialog command-palette';
  dialog.setAttribute('aria-label', 'Command palette');
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = 'Search commands or components…';
  search.setAttribute('aria-label', 'Search commands');
  const list = document.createElement('div');
  list.className = 'command-results';
  const render = () => {
    list.replaceChildren();
    for (const command of commands
      .filter((c) => c.label.toLowerCase().includes(search.value.toLowerCase()))
      .slice(0, 30)) {
      const button = document.createElement('button');
      button.textContent = command.label;
      button.onclick = () => {
        dialog.close();
        command.run();
      };
      list.append(button);
    }
  };
  search.oninput = render;
  dialog.onkeydown = (event) => {
    const buttons = [...list.querySelectorAll('button')];
    const active =
      document.activeElement instanceof HTMLButtonElement
        ? buttons.indexOf(document.activeElement)
        : -1;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      buttons[
        (active +
          (event.key === 'ArrowDown' ? 1 : buttons.length - 1) +
          buttons.length) %
          buttons.length
      ]?.focus();
    }
    if (event.key === 'Enter' && document.activeElement === search) {
      event.preventDefault();
      buttons[0]?.click();
    }
  };
  dialog.append(search, list);
  dialog.onclose = () => dialog.remove();
  document.body.append(dialog);
  render();
  dialog.showModal();
  search.focus();
}
