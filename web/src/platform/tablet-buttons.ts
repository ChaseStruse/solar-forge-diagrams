/**
 * Tablet express keys and wheels reach the app as ordinary key combos, so a
 * binding maps a combo string such as "Ctrl+Alt+K" to an app action.
 */
export const tabletActions = [
  { id: 'wheel-next', label: 'Next in Components menu', group: 'Components' },
  {
    id: 'wheel-previous',
    label: 'Previous in Components menu',
    group: 'Components',
  },
  { id: 'pick', label: 'Add highlighted component', group: 'Components' },
  { id: 'deselect', label: 'Deselect · cancel', group: 'Edit' },
  { id: 'tool-select', label: 'Select tool', group: 'Tools' },
  { id: 'tool-pan', label: 'Pan tool', group: 'Tools' },
  { id: 'tool-connect', label: 'Connect tool', group: 'Tools' },
  { id: 'tool-sketch', label: 'Sketch tool', group: 'Tools' },
  { id: 'tool-text', label: 'Text tool', group: 'Tools' },
  { id: 'tool-note', label: 'Sticky note tool', group: 'Tools' },
  { id: 'tool-add', label: 'Open Components menu', group: 'Tools' },
  { id: 'undo', label: 'Undo', group: 'Edit' },
  { id: 'redo', label: 'Redo', group: 'Edit' },
  { id: 'delete', label: 'Delete selection', group: 'Edit' },
  { id: 'zoom-in', label: 'Zoom in', group: 'View' },
  { id: 'zoom-out', label: 'Zoom out', group: 'View' },
  { id: 'fit', label: 'Fit diagram', group: 'View' },
  { id: 'journey', label: 'Play / stop journey', group: 'View' },
  { id: 'tablet-mode', label: 'Tablet mode on / off', group: 'View' },
] as const;
export type TabletAction = (typeof tabletActions)[number]['id'];
export type TabletBindings = Partial<Record<TabletAction, string>>;

/** Name of the pen side button, which the native app reads from the tablet. */
export const penSideButton = 'Pen side button';

/** Mappings a new install starts with. */
export const defaultBindings: TabletBindings = { 'tool-pan': penSideButton };

/**
 * Add default mappings once: only for actions without a mapping, and only
 * with controls not already mapped to something else.
 */
export function withDefaults(bindings: TabletBindings): TabletBindings {
  const next = { ...bindings };
  for (const action of tabletActions) {
    const combo = defaultBindings[action.id];
    if (combo && !next[action.id] && !actionForCombo(next, combo))
      next[action.id] = combo;
  }
  return next;
}

/** Actions that should fire again while a key auto-repeats. */
export const repeatingActions: ReadonlySet<TabletAction> = new Set([
  'wheel-next',
  'wheel-previous',
  'zoom-in',
  'zoom-out',
  'undo',
  'redo',
]);

/** Combos the app already uses from the keyboard. */
const builtInCombos = new Set([
  'V',
  'M',
  'C',
  'B',
  'W',
  'A',
  'S',
  'D',
  'T',
  'N',
  'F',
  'P',
  '/',
  'Escape',
  'Delete',
  'Backspace',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Ctrl+Z',
  'Ctrl+Shift+Z',
  'Ctrl+Y',
  'Ctrl+A',
  'Ctrl+C',
  'Ctrl+V',
  'Ctrl+X',
  'Ctrl+D',
  'Ctrl+G',
  'Ctrl+Shift+G',
  'Ctrl+K',
  'Ctrl+S',
  'Ctrl+Shift+S',
  'Ctrl+O',
  'Ctrl+N',
  'Ctrl+Shift+C',
  'Mouse middle',
  'Mouse right',
]);

const modifierKeys = new Set([
  'Control',
  'Shift',
  'Alt',
  'Meta',
  'AltGraph',
  'Super',
  'Hyper',
  'OS',
]);

interface KeyLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/**
 * Normalise a key event to a combo string, or undefined for a lone modifier.
 * Letters are upper-cased so Shift does not change the key name; keys the
 * browser cannot name fall back to their physical code.
 */
export function comboFromEvent(event: KeyLike): string | undefined {
  if (modifierKeys.has(event.key)) return undefined;
  let key = event.key;
  if (!key || key === 'Unidentified' || key === 'Dead') key = event.code;
  if (!key) return undefined;
  if (key === ' ') key = 'Space';
  // Shift changes the character ("!" for "1"); the physical digit is stabler.
  if (event.shiftKey && /^Digit\d$/.test(event.code)) key = event.code.slice(5);
  if (key.length === 1) key = key.toUpperCase();
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Super');
  parts.push(key);
  return parts.join('+');
}

export function isBuiltInCombo(combo: string): boolean {
  return builtInCombos.has(combo.replace(/^Super\+/, 'Ctrl+'));
}

export function actionForCombo(
  bindings: TabletBindings,
  combo: string,
): TabletAction | undefined {
  for (const action of tabletActions)
    if (bindings[action.id] === combo) return action.id;
  return undefined;
}

/** Bind a combo to one action, taking it away from any other action. */
export function assignCombo(
  bindings: TabletBindings,
  action: TabletAction,
  combo: string,
): { bindings: TabletBindings; replaced: TabletAction | undefined } {
  const replaced = actionForCombo(bindings, combo);
  const next = { ...bindings, [action]: combo };
  if (replaced && replaced !== action) delete next[replaced];
  return {
    bindings: next,
    replaced: replaced === action ? undefined : replaced,
  };
}

/** Keep only known actions with string combos from untrusted storage. */
export function parseBindings(raw: string | null): TabletBindings {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return {};
    const result: TabletBindings = {};
    for (const action of tabletActions) {
      const combo = (value as Record<string, unknown>)[action.id];
      if (typeof combo === 'string' && combo.length > 0 && combo.length < 64)
        result[action.id] = combo;
    }
    return result;
  } catch {
    return {};
  }
}

/** Wheel movement per step for each sensitivity level, least to most. */
export const dialLevels = [80, 60, 45, 32, 24, 16, 10, 6, 3, 1] as const;

/**
 * Turn raw wheel movement into whole steps. The first report of a turn
 * (`fresh`, or a change of direction) steps at once, because slow turns start
 * with tiny reports; after that, movement below one step carries over.
 */
export function dialSteps(
  pending: number,
  delta: number,
  perStep: number,
  fresh = false,
): { steps: number; pending: number } {
  if (!delta) return { steps: 0, pending };
  if (fresh || Math.sign(pending) === -Math.sign(delta))
    return { steps: Math.sign(delta), pending: 0 };
  const total = pending + delta;
  const steps = Math.trunc(total / perStep) || 0;
  return { steps, pending: total - steps * perStep };
}

/**
 * Name a pen or mouse button for a binding, or undefined for the pen tip or
 * left button, which stay for drawing and clicking. A pen's side button
 * usually arrives as a middle or right click.
 */
export function comboFromPointer(event: {
  button: number;
  pointerType: string;
}): string | undefined {
  if (event.button < 1) return undefined;
  const pen = event.pointerType === 'pen';
  const names: Record<number, string> = pen
    ? {
        1: 'Pen button (middle click)',
        2: 'Pen button (right click)',
        5: 'Pen eraser',
      }
    : {
        1: 'Mouse middle',
        2: 'Mouse right',
        3: 'Mouse back',
        4: 'Mouse forward',
      };
  return (
    names[event.button] ?? `${pen ? 'Pen' : 'Mouse'} button ${event.button}`
  );
}
