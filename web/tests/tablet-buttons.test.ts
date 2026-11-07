import { expect, test } from 'bun:test';
import {
  actionForCombo,
  assignCombo,
  comboFromEvent,
  comboFromPointer,
  dialSteps,
  isBuiltInCombo,
  parseBindings,
  withDefaults,
} from '../src/platform/tablet-buttons';

const key = (
  key: string,
  code: string,
  mods: Partial<Record<string, boolean>> = {},
) => ({
  key,
  code,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
});

test('combos are stable across shift and unnamed keys', () => {
  expect(comboFromEvent(key('z', 'KeyZ', { ctrlKey: true }))).toBe('Ctrl+Z');
  expect(
    comboFromEvent(key('Z', 'KeyZ', { ctrlKey: true, shiftKey: true })),
  ).toBe('Ctrl+Shift+Z');
  expect(comboFromEvent(key('!', 'Digit1', { shiftKey: true }))).toBe(
    'Shift+1',
  );
  expect(comboFromEvent(key('Unidentified', 'F13'))).toBe('F13');
  expect(comboFromEvent(key('Control', 'ControlLeft', { ctrlKey: true }))).toBe(
    undefined,
  );
  expect(comboFromEvent(key(' ', 'Space', { altKey: true }))).toBe('Alt+Space');
});

test('assigning a combo moves it off its previous action', () => {
  const first = assignCombo({}, 'undo', 'Ctrl+Alt+1');
  const second = assignCombo(first.bindings, 'redo', 'Ctrl+Alt+1');
  expect(second.replaced).toBe('undo');
  expect(second.bindings).toEqual({ redo: 'Ctrl+Alt+1' });
  expect(actionForCombo(second.bindings, 'Ctrl+Alt+1')).toBe('redo');
  expect(assignCombo(second.bindings, 'redo', 'Ctrl+Alt+1').replaced).toBe(
    undefined,
  );
});

test('stored bindings are filtered', () => {
  expect(
    parseBindings('{"undo":"Ctrl+Z","bogus":"X","redo":5,"fit":""}'),
  ).toEqual({ undo: 'Ctrl+Z' });
  expect(parseBindings('not json')).toEqual({});
  expect(parseBindings(null)).toEqual({});
});

test('built-in shortcuts are recognised', () => {
  expect(isBuiltInCombo('Ctrl+Z')).toBe(true);
  expect(isBuiltInCombo('Super+S')).toBe(true);
  expect(isBuiltInCombo('Ctrl+Alt+F1')).toBe(false);
});

test('wheel movement accumulates into steps', () => {
  expect(dialSteps(0, 50, 120)).toEqual({ steps: 0, pending: 50 });
  expect(dialSteps(50, 80, 120)).toEqual({ steps: 1, pending: 10 });
  expect(dialSteps(0, 250, 120)).toEqual({ steps: 2, pending: 10 });
  expect(dialSteps(0, 1, 1)).toEqual({ steps: 1, pending: 0 });
  expect(dialSteps(7, 0, 10)).toEqual({ steps: 0, pending: 7 });
});

test('a turn steps on its first report', () => {
  expect(dialSteps(0, 1, 10, true)).toEqual({ steps: 1, pending: 0 });
  expect(dialSteps(6, -1, 10, true)).toEqual({ steps: -1, pending: 0 });
  // Reversing direction mid-turn also steps at once.
  expect(dialSteps(9, -1, 10)).toEqual({ steps: -1, pending: 0 });
});

test('pen and mouse buttons are named, the tip and left button are not', () => {
  expect(comboFromPointer({ button: 0, pointerType: 'pen' })).toBe(undefined);
  expect(comboFromPointer({ button: -1, pointerType: 'pen' })).toBe(undefined);
  expect(comboFromPointer({ button: 2, pointerType: 'pen' })).toBe(
    'Pen button (right click)',
  );
  expect(comboFromPointer({ button: 1, pointerType: 'mouse' })).toBe(
    'Mouse middle',
  );
  expect(comboFromPointer({ button: 7, pointerType: 'pen' })).toBe(
    'Pen button 7',
  );
  expect(isBuiltInCombo('Mouse right')).toBe(true);
});

test('defaults fill gaps without taking mapped controls', () => {
  expect(withDefaults({})).toEqual({ 'tool-pan': 'Pen side button' });
  expect(withDefaults({ 'tool-pan': 'F13' })).toEqual({ 'tool-pan': 'F13' });
  expect(withDefaults({ undo: 'Pen side button' })).toEqual({
    undo: 'Pen side button',
  });
});
