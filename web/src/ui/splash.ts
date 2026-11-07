/**
 * The loading screen in index.html covers the window until the app is ready
 * to show: board fonts loaded and the first board frame drawn. It then fades
 * out, or disappears at once when the system asks for reduced motion.
 */
const FONT_WAIT_MS = 1500;
const FADE_MS = 350;

const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export async function dismissSplash(
  ready: Promise<unknown> = document.fonts?.ready ?? Promise.resolve(),
): Promise<void> {
  const splash = document.getElementById('splash');
  if (!splash) return;
  // Never hold the app back for long on a slow or missing font.
  await Promise.race([
    ready.catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, FONT_WAIT_MS)),
  ]);
  // Two frames: the board renders on the first, the browser paints it by the second.
  await nextFrame();
  await nextFrame();
  removeSplash(splash);
}

/** Take the loading screen down now, e.g. to show a startup error. */
export function removeSplash(
  splash: HTMLElement | null = document.getElementById('splash'),
): void {
  if (!splash || splash.classList.contains('splash-done')) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    splash.remove();
    return;
  }
  splash.classList.add('splash-done');
  setTimeout(() => splash.remove(), FADE_MS + 50);
}
