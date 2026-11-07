import { expect, test } from 'bun:test';
import { defaultTheme, findTheme, themes } from '../src/themes';

const hex = /^#[0-9a-f]{6}$/i;
function luminance(color: string): number {
  const channel = (offset: number) => {
    const value = Number.parseInt(color.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}
function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

test('every theme is complete, unique and uses plain hex colours', () => {
  expect(new Set(themes.map((theme) => theme.id)).size).toBe(themes.length);
  const keys = Object.keys(defaultTheme.css).sort();
  for (const theme of themes) {
    expect(Object.keys(theme.css).sort()).toEqual(keys);
    for (const value of Object.values(theme.css)) expect(value).toMatch(hex);
    const scene = theme.scene;
    for (const value of [
      ...scene.sky,
      ...scene.grid,
      scene.glow,
      scene.fog,
      scene.tile,
      scene.face,
      scene.outline,
      scene.group,
      scene.shadow,
      scene.selected,
      scene.edge,
      scene.edgeHover,
      scene.edgeSelected,
      scene.flow,
      scene.port,
      scene.handle,
      scene.guide,
      scene.glyph,
      scene.text,
      scene.groupLabel,
      ...Object.values(scene.nodeLabel),
      ...Object.values(scene.edgeLabel),
      ...Object.values(scene.note),
    ])
      expect(value).toMatch(hex);
    expect(theme.name.length).toBeGreaterThan(0);
    expect(theme.tagline.length).toBeGreaterThan(0);
    expect(theme.mark.length).toBeGreaterThan(0);
  }
});

test('theme text stays readable', () => {
  for (const { css, scene } of themes) {
    expect(contrast(css.text ?? '', css.panel ?? '')).toBeGreaterThanOrEqual(7);
    expect(contrast(css.muted ?? '', css.panel ?? '')).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(
      contrast(css['on-accent'] ?? '', css.accent ?? ''),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(scene.nodeLabel.text, scene.nodeLabel.background),
    ).toBeGreaterThanOrEqual(7);
    expect(contrast(scene.note.text, scene.note.paper)).toBeGreaterThanOrEqual(
      4.5,
    );
  }
});

test('showpiece themes ship their extras and unknown ids fall back', () => {
  for (const id of [
    'cyberpunk',
    'hacker',
    'solar-ram',
    'zen-garden',
    'monochrome',
    'comic-noir',
    'space',
  ]) {
    const theme = findTheme(id);
    expect(theme.id).toBe(id);
    expect(theme.group).toBe('Over the top');
    expect(theme.ambient).toBeDefined();
    const flow = theme.scene.flowStyle;
    expect(flow && flow.dash > 0 && flow.gap > 0 && flow.speed > 0).toBe(true);
  }
  expect(findTheme('monochrome').scene.monochrome).toBe(true);
  expect(findTheme('no-such-theme')).toBe(defaultTheme);
  expect(findTheme(null)).toBe(defaultTheme);
});
