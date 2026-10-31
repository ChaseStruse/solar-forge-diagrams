import { invoke, isTauri } from '@tauri-apps/api/core';

/**
 * Enter or leave full screen for tablet mode. The native app also moves to the
 * monitor Hyprland maps the pen to, and returns that monitor's name if it did.
 */
export async function setTabletFullscreen(
  enabled: boolean,
): Promise<string | undefined> {
  if (isTauri())
    return (
      (await invoke<string | null>('set_tablet_mode', { enabled })) ?? undefined
    );
  if (enabled && !document.fullscreenElement)
    await document.documentElement.requestFullscreen();
  else if (!enabled && document.fullscreenElement)
    await document.exitFullscreen();
  return undefined;
}

export type DialEvent =
  | { kind: 'turn'; delta: number }
  | { kind: 'press' }
  | { kind: 'pen'; pressed: boolean };
export type DialStatus = 'absent' | 'permission' | 'connected';

/**
 * Kamvas wheels and pen side button, read by the native app from the
 * tablet's HID interface. A browser build has no access, so it reports the
 * wheels as absent.
 */
export async function watchTabletDial(
  onEvent: (event: DialEvent) => void,
  onStatus: (status: DialStatus) => void,
): Promise<void> {
  if (!isTauri()) {
    onStatus('absent');
    return;
  }
  const { listen } = await import('@tauri-apps/api/event');
  await listen<DialEvent>('tablet-dial', (event) => onEvent(event.payload));
  await listen<DialStatus>('tablet-dial-status', (event) =>
    onStatus(event.payload),
  );
  onStatus(await invoke<DialStatus>('tablet_dial_status'));
}
