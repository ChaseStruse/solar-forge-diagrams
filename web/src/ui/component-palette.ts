import type { App } from '../app/context';
import { services } from '../catalog/services';
import { defaultSize, insertionSlot } from '../editor/operations';
import { element, inputElement } from './dom';

export interface ComponentPalette {
  show(show: boolean): void;
  isOpen(): boolean;
  /** List the components matching a search, highlighting the first. */
  populate(query?: string): void;
  /** Move the highlight by `by` rows, wrapping around. */
  step(by: number): void;
  addHighlighted(): void;
}

/**
 * The Components popover: searchable service list with keyboard highlight;
 * choosing one drops it on the board.
 */
export function installComponentPalette(app: App): ComponentPalette {
  const {
    state,
    scene,
    notify,
    deferInspect,
    updateHeader,
    selectTool,
    openEditor,
  } = app;
  function showComponents(show: boolean): void {
    element('component-palette').hidden = !show;
    element('components').setAttribute('aria-expanded', String(show));
    if (show) {
      element('file-menu').hidden = true;
      inputElement('search').value = '';
      populateServices();
      inputElement('search').focus();
    }
  }
  for (const id of ['components', 'tool-add', 'layer-add'])
    element(id).onclick = () =>
      showComponents(element('component-palette').hidden);
  element('close-components').onclick = () => showComponents(false);
  /** Palette rows are built once; searching only filters and re-orders them. */
  const serviceRows = services.map((service) => ({
    service,
    search:
      `${service.label} ${service.category} ${service.aliases}`.toLowerCase(),
    button: undefined as HTMLButtonElement | undefined,
  }));
  function serviceButton(
    service: (typeof services)[number],
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'service';
    const symbol = document.createElement('span');
    symbol.className = 'service-symbol';
    symbol.style.color = service.color;
    if (service.icon) {
      const image = document.createElement('img');
      image.loading = 'lazy';
      image.decoding = 'async';
      image.src = service.icon;
      image.alt = '';
      symbol.append(image);
    } else symbol.textContent = service.glyph;
    const text = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = service.label;
    const detail = document.createElement('small');
    detail.textContent = service.description;
    text.append(name, detail);
    button.append(symbol, text);
    button.onclick = () => addService(service);
    return button;
  }
  function populateServices(query = ''): void {
    const list = element('services');
    const needle = query.toLowerCase();
    list.replaceChildren();
    for (const row of serviceRows) {
      if (!row.search.includes(needle)) continue;
      row.button ??= serviceButton(row.service);
      list.append(row.button);
    }
    if (!list.childElementCount) {
      const empty = document.createElement('p');
      empty.className = 'empty-search';
      empty.textContent = 'No matching services. Try another name.';
      list.append(empty);
    }
    highlightService(0);
  }
  function addService(service: (typeof services)[number]): void {
    const id = crypto.randomUUID();
    const [width, depth] = defaultSize(service.kind);
    let point: { x: number; z: number };
    try {
      point = insertionSlot(
        state.current,
        scene.insertionPoint(),
        width,
        depth,
      );
    } catch (error) {
      notify(String(error));
      return;
    }
    state.history.execute({
      type: 'insert',
      node: {
        id,
        kind: service.kind,
        serviceId: service.id,
        ...(service.shape ? { shape: service.shape } : {}),
        ...(service.boundary ? { boundary: service.boundary } : {}),
        ...(service.policyKind
          ? {
              policy:
                service.policyKind === 'route-table'
                  ? { kind: 'route-table' as const, routes: [] }
                  : { kind: service.policyKind, rules: [] },
            }
          : {}),
        label: service.label,
        x: Math.round(point.x / 10) * 10,
        z: Math.round(point.z / 10) * 10,
        width,
        depth,
        color: service.color,
      },
    });
    deferInspect(() => scene.update(state.current));
    scene.select(id);
    scene.reveal(id);
    updateHeader();
    showComponents(false);
    selectTool('select');
    notify(`${service.label} added`);
    if (service.kind === 'text' || service.kind === 'note')
      openEditor({ kind: 'node', id }, true);
  }
  let highlighted = 0;
  function serviceButtons(): HTMLButtonElement[] {
    return [
      ...element('services').querySelectorAll<HTMLButtonElement>('button'),
    ];
  }
  function highlightService(index: number): void {
    const buttons = serviceButtons();
    highlighted = buttons.length
      ? (index + buttons.length) % buttons.length
      : 0;
    for (const [i, button] of buttons.entries())
      button.classList.toggle('highlighted', i === highlighted);
    buttons[highlighted]?.scrollIntoView({ block: 'nearest' });
  }
  element('search').oninput = () =>
    populateServices(inputElement('search').value);
  // Type to filter, arrows to choose, Enter drops the match on the board.
  element('search').onkeydown = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      highlightService(highlighted + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      serviceButtons()[highlighted]?.click();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      showComponents(false);
    }
  };

  return {
    show: showComponents,
    isOpen: () => !element('component-palette').hidden,
    populate: populateServices,
    step: (by) => highlightService(highlighted + by),
    addHighlighted: () => serviceButtons()[highlighted]?.click(),
  };
}
