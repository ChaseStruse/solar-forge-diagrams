import {
  type DialStatus,
  setTabletFullscreen,
  watchTabletDial,
} from '../platform/tablet';
import {
  actionForCombo,
  assignCombo,
  comboFromEvent,
  comboFromPointer,
  dialLevels,
  dialSteps,
  isBuiltInCombo,
  parseBindings,
  penSideButton,
  repeatingActions,
  type TabletAction,
  type TabletBindings,
  tabletActions,
  withDefaults,
} from '../platform/tablet-buttons';
import type { DiagramScene } from '../renderer/scene';
import { element, inputElement, isTextTarget } from '../ui/dom';
import { icon } from '../ui/icons';

/** What tablet mode, button mappings and wheels need from the rest of the app. */
export interface TabletHost {
  scene: Pick<DiagramScene, 'zoomBy' | 'onPenInput'>;
  notify(message: string): void;
  /** While a recording runs, buttons and keys are left alone. */
  isRecording(): boolean;
  layersVisible(): boolean;
  showLayers(show: boolean): void;
  components: {
    isOpen(): boolean;
    open(): void;
    /** Move the highlight in the open Components list. */
    step(by: number): void;
    addHighlighted(): void;
  };
  /** Go back to the Select tool. */
  selectTool(): void;
  /**
   * App actions a mapped control can run. An action not listed here clicks the
   * element whose id matches the action.
   */
  actions: Partial<Record<TabletAction, () => void>>;
}

export interface TabletControls {
  showSettings(show: boolean): void;
}

const toolActions: readonly TabletAction[] = [
  'tool-pan',
  'tool-connect',
  'tool-sketch',
  'tool-text',
  'tool-note',
];
const bindingsKey = 'solar-forge-tablet-buttons';
// Defaults are added once, so clearing one later sticks.
const defaultsKey = 'solar-forge-tablet-defaults';
const dialKey = 'solar-forge-tablet-dial';
const dialMessages: Record<DialStatus, string> = {
  connected:
    'Wheels connected. Turn a wheel to zoom. Press its centre to open Components, turn to scroll, and press again to add the highlighted one.',
  permission:
    'The tablet is plugged in, but the app is not allowed to read its wheels. Install the tablet permission rule (see the user guide), then unplug and replug the tablet.',
  absent:
    'No Huion tablet found. The wheels work in the desktop app with the tablet plugged in.',
};
// Pen side buttons and extra mouse buttons arrive as clicks, not keys. WebKit
// may report one only as a change in the held-buttons mask of a move, so the
// mask is compared too. Bits after the first: right, middle, back, forward,
// eraser, matching button numbers 2, 1, 3, 4, 5.
const maskButtons = [
  [2, 2],
  [4, 1],
  [8, 3],
  [16, 4],
  [32, 5],
] as const;

function loadBindings(): TabletBindings {
  try {
    const saved = parseBindings(localStorage.getItem(bindingsKey));
    if (localStorage.getItem(defaultsKey) === '1') return saved;
    const next = withDefaults(saved);
    localStorage.setItem(bindingsKey, JSON.stringify(next));
    localStorage.setItem(defaultsKey, '1');
    return next;
  } catch {
    return withDefaults({});
  }
}

function loadDial(): { sensitivity: number; reverse: boolean } {
  const fallback = { sensitivity: 7, reverse: false };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(dialKey) ?? '{}');
    if (!saved || typeof saved !== 'object') return fallback;
    const { sensitivity, reverse } = saved as Record<string, unknown>;
    return {
      sensitivity:
        typeof sensitivity === 'number' &&
        Number.isInteger(sensitivity) &&
        sensitivity >= 1 &&
        sensitivity <= dialLevels.length
          ? sensitivity
          : fallback.sensitivity,
      reverse: reverse === true,
    };
  } catch {
    return fallback;
  }
}

/**
 * Tablet mode, the Settings panel's button mappings, Huion wheels, and the
 * key, pen and mouse-button listeners that run mapped actions.
 */
export function installTabletControls(host: TabletHost): TabletControls {
  const { notify, scene } = host;
  let tabletMode = false;
  let layersBeforeTablet = true;
  let penHintShown = false;
  let bindings = loadBindings();
  let learningAction: TabletAction | undefined;
  const dial = loadDial();

  scene.onPenInput = (pen) => {
    document.body.classList.toggle('pen-input', pen);
    if (pen && !penHintShown && !tabletMode) {
      penHintShown = true;
      notify(
        'Pen detected. Tablet mode (top bar) goes full screen on the pen display.',
      );
    }
  };

  async function setTabletMode(on: boolean): Promise<void> {
    if (on === tabletMode) return;
    tabletMode = on;
    document.body.classList.toggle('tablet-mode', on);
    element('tablet-mode').setAttribute('aria-pressed', String(on));
    if (on) {
      layersBeforeTablet = host.layersVisible();
      host.showLayers(false);
    } else host.showLayers(layersBeforeTablet);
    try {
      const monitor = await setTabletFullscreen(on);
      notify(
        on
          ? `Tablet mode${monitor ? ` on ${monitor.replace(/^desc:/, '')}` : ''}. Tap the tablet button to leave.`
          : 'Tablet mode off',
      );
    } catch (error) {
      notify(
        `Full screen unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  element('tablet-mode').onclick = () => void setTabletMode(!tabletMode);

  function saveBindings(next: TabletBindings): void {
    bindings = next;
    try {
      localStorage.setItem(bindingsKey, JSON.stringify(next));
    } catch {
      notify('Button mappings changed for this session.');
    }
    renderBindings();
  }

  function renderBindings(): void {
    const list = element('tablet-bindings');
    list.replaceChildren();
    let group = '';
    for (const action of tabletActions) {
      if (action.group !== group) {
        group = action.group;
        const caption = document.createElement('p');
        caption.className = 'section-label';
        caption.textContent = group.toUpperCase();
        list.append(caption);
      }
      const row = document.createElement('div');
      row.className = 'binding-row';
      const label = document.createElement('span');
      label.textContent = action.label;
      const combo = document.createElement('kbd');
      const learning = learningAction === action.id;
      combo.textContent = learning
        ? 'Press a control…'
        : (bindings[action.id] ?? '—');
      combo.classList.toggle('unbound', !learning && !bindings[action.id]);
      const assign = document.createElement('button');
      assign.textContent = learning ? 'Cancel' : 'Assign';
      assign.setAttribute(
        'aria-label',
        `${assign.textContent} ${action.label}`,
      );
      assign.onclick = () => {
        learningAction = learning ? undefined : action.id;
        renderBindings();
      };
      const clear = document.createElement('button');
      clear.className = 'small-icon';
      clear.innerHTML = icon('close');
      clear.setAttribute('aria-label', `Clear ${action.label}`);
      clear.disabled = !bindings[action.id];
      clear.onclick = () => {
        const next = { ...bindings };
        delete next[action.id];
        saveBindings(next);
      };
      row.append(label, combo, assign, clear);
      list.append(row);
    }
  }

  function showSettings(show: boolean): void {
    element('settings-panel').hidden = !show;
    element('settings').setAttribute('aria-expanded', String(show));
    if (!show) learningAction = undefined;
    renderBindings();
  }
  element('settings').onclick = () =>
    showSettings(element('settings-panel').hidden);
  element('close-settings').onclick = () => showSettings(false);
  element('tablet-bindings-reset').onclick = () => {
    learningAction = undefined;
    saveBindings({});
    notify('Tablet button mappings cleared.');
  };

  /** Wheel turns open the Components menu, then move through its list. */
  function stepComponents(direction: 1 | -1): void {
    if (!host.components.isOpen()) host.components.open();
    else host.components.step(direction);
  }
  /** Add the highlighted component; opens the menu first if it is closed. */
  function addHighlightedComponent(): void {
    if (!host.components.isOpen()) host.components.open();
    else host.components.addHighlighted();
  }

  function runAction(action: TabletAction): void {
    // A tool's button pressed again goes back to Select.
    if (
      toolActions.includes(action) &&
      element(action).getAttribute('aria-pressed') === 'true'
    ) {
      host.selectTool();
      return;
    }
    switch (action) {
      case 'wheel-next':
        stepComponents(1);
        return;
      case 'wheel-previous':
        stepComponents(-1);
        return;
      case 'pick':
        addHighlightedComponent();
        return;
      case 'tablet-mode':
        void setTabletMode(!tabletMode);
        return;
    }
    const run = host.actions[action];
    if (run) run();
    else element(action).click();
  }

  function learnCombo(combo: string): void {
    const action = learningAction;
    if (!action) return;
    learningAction = undefined;
    if (combo === 'Escape') {
      renderBindings();
      return;
    }
    const result = assignCombo(bindings, action, combo);
    saveBindings(result.bindings);
    const label = (id: TabletAction) =>
      tabletActions.find((a) => a.id === id)?.label ?? id;
    notify(
      [
        `${combo} → ${label(action)}.`,
        result.replaced ? `Removed from ${label(result.replaced)}.` : '',
        isBuiltInCombo(combo)
          ? `${combo} is also a built-in shortcut; the mapping now replaces it.`
          : '',
      ]
        .filter(Boolean)
        .join(' '),
    );
  }

  // Kamvas wheels: turning steps the highlight, pressing selects it.
  function saveDial(): void {
    try {
      localStorage.setItem(dialKey, JSON.stringify(dial));
    } catch {
      notify('Wheel settings changed for this session.');
    }
  }
  inputElement('dial-sensitivity').value = String(dial.sensitivity);
  inputElement('dial-reverse').checked = dial.reverse;
  inputElement('dial-sensitivity').oninput = () => {
    dial.sensitivity = Number(inputElement('dial-sensitivity').value);
    saveDial();
  };
  inputElement('dial-reverse').onchange = () => {
    dial.reverse = inputElement('dial-reverse').checked;
    saveDial();
  };
  let dialPending = 0;
  let dialLastTurn = 0;
  void watchTabletDial(
    (event) => {
      if (event.kind === 'pen') {
        if (!event.pressed) return;
        const action = actionForCombo(bindings, penSideButton);
        if (learningAction) learnCombo(penSideButton);
        else if (action) runAction(action);
        return;
      }
      // Press opens Components, or adds the highlighted entry when it is open.
      if (event.kind === 'press') {
        addHighlightedComponent();
        dialPending = 0;
        dialLastTurn = 0;
        return;
      }
      const now = performance.now();
      const fresh = now - dialLastTurn > 350;
      dialLastTurn = now;
      const result = dialSteps(
        dialPending,
        dial.reverse ? -event.delta : event.delta,
        dialLevels[dial.sensitivity - 1] ?? 10,
        fresh,
      );
      dialPending = result.pending;
      if (!result.steps) return;
      // Turning scrolls the open menu and zooms the board otherwise.
      if (host.components.isOpen()) host.components.step(result.steps);
      else scene.zoomBy(1.1 ** result.steps);
    },
    (status) => {
      element('dial-status').textContent = dialMessages[status];
    },
  ).catch((error: unknown) => {
    element('dial-status').textContent =
      `Wheels unavailable: ${error instanceof Error ? error.message : String(error)}`;
  });

  // Registered before the other key handlers so a mapped combo wins.
  window.addEventListener(
    'keydown',
    (event) => {
      if (host.isRecording()) return;
      const combo = comboFromEvent(event);
      if (learningAction) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!combo || event.repeat) return;
        learnCombo(combo);
        return;
      }
      if (!combo) return;
      const action = actionForCombo(bindings, combo);
      if (!action) return;
      // Plain keys typed into a field stay text.
      if (
        isTextTarget(event.target) &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat && !repeatingActions.has(action)) return;
      runAction(action);
    },
    { capture: true },
  );

  const heldButtons = new Map<number, number>();
  let swallowContextMenu = false;
  let lastPointerBinding = 0;
  function pressedButton(event: PointerEvent): number | undefined {
    const before = heldButtons.get(event.pointerId) ?? 0;
    heldButtons.set(event.pointerId, event.buttons);
    if (event.button >= 1 && event.type !== 'pointerup') return event.button;
    const added = event.buttons & ~before;
    return maskButtons.find(([bit]) => added & bit)?.[1];
  }
  function bindPointerButton(
    event: Event,
    button: number,
    pointerType: string,
  ): boolean {
    const combo = comboFromPointer({ button, pointerType });
    if (!combo) return false;
    const action = learningAction ? undefined : actionForCombo(bindings, combo);
    if (!learningAction && !action) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    swallowContextMenu = true;
    lastPointerBinding = performance.now();
    if (learningAction) learnCombo(combo);
    else if (action) runAction(action);
    return true;
  }
  function pointerBinding(event: PointerEvent): void {
    if (host.isRecording()) return;
    const button = pressedButton(event);
    if (button !== undefined)
      bindPointerButton(event, button, event.pointerType);
  }
  window.addEventListener('pointerdown', pointerBinding, { capture: true });
  window.addEventListener('pointermove', pointerBinding, { capture: true });
  window.addEventListener(
    'pointerup',
    (event) => {
      heldButtons.set(event.pointerId, event.buttons);
    },
    { capture: true },
  );
  // Fallback for buttons that produce mouse events without pointer events.
  for (const type of ['mousedown', 'auxclick'] as const)
    window.addEventListener(
      type,
      (event) => {
        if (
          host.isRecording() ||
          performance.now() - lastPointerBinding < 300
        ) {
          if (swallowContextMenu) event.preventDefault();
          return;
        }
        bindPointerButton(event, event.button, 'mouse');
      },
      { capture: true },
    );
  window.addEventListener(
    'contextmenu',
    (event) => {
      if (learningAction) {
        event.preventDefault();
        return;
      }
      if (!swallowContextMenu) return;
      swallowContextMenu = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    { capture: true },
  );
  window.addEventListener(
    'pointerup',
    () => {
      // Clear after this release's contextmenu, which follows pointerup.
      if (swallowContextMenu) setTimeout(() => (swallowContextMenu = false), 0);
    },
    { capture: true },
  );

  return { showSettings };
}
