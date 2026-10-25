import type { Ambient } from '../themes';

const RAIN = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄ0101<>{}#$%=+*';

/**
 * Decorative particles behind the editor chrome. Pure CSS animation on a
 * handful of elements: no per-frame script, no effect on the board or exports.
 */
export function renderAmbient(
  host: HTMLElement,
  ambient: Ambient | undefined,
): void {
  host.replaceChildren();
  host.dataset.ambient = ambient ?? '';
  if (!ambient) return;
  const random = Math.random;
  const spawn = (className: string, style: Record<string, string>) => {
    const element = document.createElement('span');
    element.className = className;
    for (const [name, value] of Object.entries(style))
      element.style.setProperty(name, value);
    host.append(element);
    return element;
  };
  const between = (low: number, high: number) => low + random() * (high - low);
  if (ambient === 'rain')
    for (let i = 0; i < 26; i++) {
      const column = spawn('fx-rain', {
        left: `${between(0, 100)}%`,
        '--fx-duration': `${between(5, 13)}s`,
        '--fx-delay': `${-between(0, 13)}s`,
        '--fx-opacity': `${between(0.12, 0.32)}`,
        'font-size': `${Math.round(between(11, 17))}px`,
      });
      column.textContent = Array.from(
        { length: Math.round(between(12, 30)) },
        () => RAIN[Math.floor(random() * RAIN.length)],
      ).join('\n');
    }
  else if (ambient === 'embers')
    for (let i = 0; i < 34; i++)
      spawn('fx-ember', {
        left: `${between(0, 100)}%`,
        '--fx-size': `${between(2, 6)}px`,
        '--fx-drift': `${between(-80, 80)}px`,
        '--fx-duration': `${between(7, 16)}s`,
        '--fx-delay': `${-between(0, 16)}s`,
      });
  else if (ambient === 'petals')
    for (let i = 0; i < 16; i++) {
      const petal = spawn('fx-petal', {
        left: `${between(-5, 100)}%`,
        '--fx-drift': `${between(60, 220)}px`,
        '--fx-duration': `${between(14, 26)}s`,
        '--fx-delay': `${-between(0, 26)}s`,
        '--fx-size': `${between(9, 16)}px`,
      });
      petal.append(document.createElement('i'));
    }
  else if (ambient === 'neon') {
    spawn('fx-scanbar', {});
    for (let i = 0; i < 7; i++)
      spawn('fx-streak', {
        top: `${between(8, 92)}%`,
        '--fx-duration': `${between(3, 9)}s`,
        '--fx-delay': `${-between(0, 9)}s`,
        '--fx-length': `${between(80, 260)}px`,
      });
  } else if (ambient === 'grain') spawn('fx-grain', {});
  else if (ambient === 'stars') {
    for (let i = 0; i < 40; i++)
      spawn('fx-star', {
        left: `${between(0, 100)}%`,
        top: `${between(0, 100)}%`,
        '--fx-size': `${between(1, 2.6)}px`,
        '--fx-duration': `${between(2.5, 7)}s`,
        '--fx-delay': `${-between(0, 7)}s`,
      });
    for (let i = 0; i < 3; i++)
      spawn('fx-comet', {
        top: `${between(4, 60)}%`,
        left: `${between(30, 100)}%`,
        '--fx-duration': `${between(9, 18)}s`,
        '--fx-delay': `${-between(0, 18)}s`,
      });
  }
}
