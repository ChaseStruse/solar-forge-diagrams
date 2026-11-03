import { boardFonts, findBoardFont, loadBoardFont } from '../fonts';
import type { DiagramScene } from '../renderer/scene';
import { applyThemeCss, findTheme, type ScenePalette, themes } from '../themes';
import { element, field, fillOptions, inputElement } from '../ui/dom';
import { renderAmbient } from '../ui/theme-fx';

export interface Appearance {
  /** Board colours of the saved theme, for creating the scene. */
  readonly initialPalette: ScenePalette;
  /** CSS family of the chosen board font, when it is not the theme's. */
  boardFontFamily(): string | undefined;
  /** Wire the theme menu, font picker, effects, quality and flow to the scene. */
  install(scene: DiagramScene): { setTheme(id: string): void };
}

/**
 * Themes, ambient effects, board fonts, rendering quality and flow animation:
 * saved preferences, applied to the window chrome at once and to the scene
 * once it exists.
 */
export function loadAppearance(notify: (message: string) => void): Appearance {
  let theme = findTheme(
    (() => {
      try {
        return localStorage.getItem('solar-forge-theme');
      } catch {
        return null;
      }
    })(),
  );
  /** Ambient theme effects: on by default unless the system asks for less motion. */
  let themeEffects = (() => {
    try {
      const saved = localStorage.getItem('solar-forge-theme-fx');
      if (saved) return saved === 'on';
    } catch {}
    return !matchMedia('(prefers-reduced-motion: reduce)').matches;
  })();
  let boardFont = findBoardFont(
    (() => {
      try {
        return localStorage.getItem('solar-forge-font');
      } catch {
        return null;
      }
    })(),
  );
  /** The theme's board colours with the chosen board font. */
  function scenePalette(): ScenePalette {
    return boardFont.family
      ? { ...theme.scene, labelFont: boardFont.family }
      : theme.scene;
  }
  function applyThemeChrome(): void {
    applyThemeCss(theme);
    document.documentElement.dataset.fx = themeEffects ? 'on' : 'off';
    if (theme.markSvg) element('forge-mark').innerHTML = theme.markSvg;
    else element('forge-mark').textContent = theme.mark;
    renderAmbient(
      element('theme-fx'),
      themeEffects ? theme.ambient : undefined,
    );
  }
  applyThemeChrome();

  return {
    initialPalette: theme.scene,
    boardFontFamily: () => boardFont.family,
    install(scene) {
      function setTheme(id: string): void {
        theme = findTheme(id);
        applyThemeChrome();
        scene.setPalette(scenePalette());
        for (const button of element('theme-list').querySelectorAll('button'))
          button.setAttribute(
            'aria-pressed',
            String(button.dataset.theme === theme.id),
          );
        try {
          localStorage.setItem('solar-forge-theme', theme.id);
        } catch {}
        notify(`${theme.name} · ${theme.tagline}`);
      }
      for (const [index, option] of themes.entries()) {
        if (option.group !== themes[index - 1]?.group) {
          const caption = document.createElement('p');
          caption.className = 'popover-caption';
          caption.textContent = option.group.toUpperCase();
          element('theme-list').append(caption);
        }
        const button = document.createElement('button');
        button.dataset.theme = option.id;
        button.setAttribute('aria-pressed', String(option.id === theme.id));
        const swatch = document.createElement('span');
        swatch.className = 'theme-swatch';
        swatch.style.background = `linear-gradient(135deg, ${option.css.bg} 0 45%, ${option.css.accent} 45% 72%, ${option.css.hot} 72%)`;
        swatch.style.color = option.css.text ?? '';
        if (option.markSvg) swatch.innerHTML = option.markSvg;
        else swatch.textContent = option.mark;
        const text = document.createElement('span');
        text.className = 'theme-text';
        const name = document.createElement('strong');
        name.textContent = option.name;
        const tagline = document.createElement('small');
        tagline.textContent = option.tagline;
        text.append(name, tagline);
        button.append(swatch, text);
        button.onclick = () => {
          setTheme(option.id);
          element('theme-menu').hidden = true;
          element('theme').setAttribute('aria-expanded', 'false');
        };
        element('theme-list').append(button);
      }
      /** Switch board text to a font, drawing only once its face has loaded. */
      async function setBoardFont(id: string, announce = true): Promise<void> {
        const font = findBoardFont(id);
        boardFont = font;
        field('board-font').value = font.id;
        try {
          await loadBoardFont(font);
        } catch {
          notify(`${font.name} font unavailable; using a fallback.`);
        }
        if (boardFont !== font) return;
        scene.setPalette(scenePalette());
        try {
          localStorage.setItem('solar-forge-font', font.id);
        } catch {}
        if (announce) notify(`Board font · ${font.name}`);
      }
      fillOptions(
        'board-font',
        boardFonts.map((font) => [font.id, font.name] as [string, string]),
        boardFont.id,
      );
      field('board-font').onchange = () =>
        void setBoardFont(field('board-font').value);
      if (boardFont.family) void setBoardFont(boardFont.id, false);
      inputElement('theme-fx-toggle').checked = themeEffects;
      inputElement('theme-fx-toggle').onchange = () => {
        themeEffects = inputElement('theme-fx-toggle').checked;
        applyThemeChrome();
        try {
          localStorage.setItem(
            'solar-forge-theme-fx',
            themeEffects ? 'on' : 'off',
          );
        } catch {}
        notify(`Ambient effects ${themeEffects ? 'on' : 'off'}`);
      };
      element('theme').onclick = () => {
        const menu = element('theme-menu');
        menu.hidden = !menu.hidden;
        element('theme').setAttribute('aria-expanded', String(!menu.hidden));
      };
      field('quality').onchange = () => {
        const ratio = Number(field('quality').value);
        scene.setQuality(ratio);
        try {
          localStorage.setItem('solar-forge-quality', String(ratio));
        } catch {
          notify('Quality changed for this session.');
        }
      };
      try {
        const quality = localStorage.getItem('solar-forge-quality');
        if (quality && ['1', '1.5', '2'].includes(quality)) {
          field('quality').value = quality;
          scene.setQuality(Number(quality));
        }
      } catch {}
      function setFlow(on: boolean): void {
        scene.setFlow(on);
        element('flow').setAttribute('aria-pressed', String(on));
        try {
          localStorage.setItem('solar-forge-flow', on ? '1' : '0');
        } catch {}
      }
      try {
        if (localStorage.getItem('solar-forge-flow') === '0') setFlow(false);
      } catch {}
      element('flow').onclick = () => setFlow(!scene.flow);

      return { setTheme };
    },
  };
}
