import { journeyStarts } from '../domain/journey';
import {
  defaultRecordingOptions,
  validateRecordingOptions,
} from '../export/recording-options';
import { exportGif, exportVideo } from '../platform/files';
import { element, field, inputElement } from '../ui/dom';
import type { App } from './context';

/**
 * Journey GIF and video export: the recording panel, the capture loop, and
 * the keyboard lock that lets only Esc (cancel) through while it runs.
 */
export function installRecording(app: App): void {
  const { state, scene, notify, action } = app;
  let recordingMode: 'gif' | 'video' = 'gif';
  let recordingAbort: AbortController | undefined;
  function openRecording(mode: 'gif' | 'video'): void {
    recordingMode = mode;
    element('file-menu').hidden = true;
    element('gif-panel').hidden = false;
    element('recording-title').textContent =
      mode === 'gif' ? 'Journey GIF' : 'Journey video';
    element('gif-record').textContent =
      mode === 'gif' ? 'Record GIF' : 'Record video';
    element('video-format-row').hidden = mode === 'gif';
    element('video-help').hidden = mode === 'gif';
    element('gif-dither-row').hidden = mode !== 'gif';
    element('gif-help').hidden = mode !== 'gif';
    inputElement('gif-duration').focus();
    if (mode === 'video')
      void import('../export/video').then(({ videoMime }) => {
        for (const option of (element('video-format') as HTMLSelectElement)
          .options) {
          const supported = !!videoMime(option.value as 'webm' | 'mp4');
          option.disabled = !supported;
          option.textContent =
            option.value.toUpperCase() + (supported ? '' : ' (unavailable)');
        }
        const select = element('video-format') as HTMLSelectElement;
        if (select.selectedOptions[0]?.disabled)
          select.value =
            [...select.options].find((option) => !option.disabled)?.value ?? '';
      });
  }
  element('export-gif').onclick = () => openRecording('gif');
  element('export-video').onclick = () => openRecording('video');

  try {
    const saved = localStorage.getItem('solar-forge-gif');
    const options = saved
      ? validateRecordingOptions(JSON.parse(saved))
      : defaultRecordingOptions;
    inputElement('gif-duration').value = String(options.duration);
    inputElement('gif-dither').checked = options.dither;
  } catch {}
  element('gif-record').onclick = () =>
    void action(async () => {
      const options = validateRecordingOptions({
        duration: Number(inputElement('gif-duration').value),
        dither: inputElement('gif-dither').checked,
      });
      try {
        localStorage.setItem('solar-forge-gif', JSON.stringify(options));
      } catch {}

      const networkPath = state.checkedJourney;
      const starts = networkPath
        ? networkPath.path.slice(0, 1)
        : journeyStarts(state.current, state.selected);
      if (!starts.length) {
        notify('Connect components before exporting a journey.');
        return;
      }
      const { recordJourney } = await import('../export/gif');
      const mode = recordingMode;
      const format = field('video-format').value as 'webm' | 'mp4';
      const video =
        mode === 'video' ? await import('../export/video') : undefined;
      if (video && !video.videoMime(format))
        throw Error('Choose an available video format');
      element('gif-panel').hidden = true;
      state.recording = true;
      recordingAbort = new AbortController();
      element('file-menu').hidden = true;
      scene.stopJourney();
      const controls = [element('app')];
      for (const control of controls) control.inert = true;
      try {
        scene.playJourney(starts, networkPath);
        const progress = (percent: number) =>
          notify(
            `Recording journey ${mode === 'gif' ? 'GIF' : format.toUpperCase()} · ${percent}% · ${options.duration} seconds · Esc cancels; decision forks use the first branch`,
          );
        const blob = video
          ? await video.recordVideo(
              () => scene.gifFrame(1280, 720),
              progress,
              recordingAbort.signal,
              { duration: options.duration, format },
            )
          : await recordJourney(
              () => scene.gifFrame(),
              progress,
              recordingAbort.signal,
              options,
            );
        scene.stopJourney();
        const saved = video
          ? await exportVideo(blob, format)
          : await exportGif(blob);
        if (saved)
          notify(
            `Journey ${video ? format.toUpperCase() : 'GIF'} exported · ${options.duration} seconds`,
          );
      } finally {
        state.recording = false;
        recordingAbort = undefined;
        scene.stopJourney();
        for (const control of controls) control.inert = false;
      }
    });
  window.addEventListener(
    'keydown',
    (event) => {
      if (!state.recording) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === 'Escape') recordingAbort?.abort();
    },
    true,
  );
}
