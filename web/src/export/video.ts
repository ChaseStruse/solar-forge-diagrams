export type VideoFormat = 'webm' | 'mp4';
export interface VideoOptions {
  duration: number;
  format: VideoFormat;
}
const codecs: Record<VideoFormat, string[]> = {
  webm: ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'],
  mp4: ['video/mp4;codecs=avc1.42E01E', 'video/mp4'],
};
export function videoMime(format: VideoFormat): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return codecs[format]?.find((mime) => MediaRecorder.isTypeSupported(mime));
}
export function validateVideoOptions(options: VideoOptions): VideoOptions {
  if (
    !Number.isInteger(options.duration) ||
    options.duration < 2 ||
    options.duration > 120 ||
    !Object.hasOwn(codecs, options.format)
  )
    throw Error('Choose WebM or MP4 and a duration from 2 to 120 seconds');
  return options;
}
/** Offline, full-colour recording. The selected container must be supported by this browser. */
export async function recordVideo(
  frame: () => HTMLCanvasElement,
  progress: (percent: number) => void,
  signal: AbortSignal,
  options: VideoOptions,
): Promise<Blob> {
  validateVideoOptions(options);
  const mimeType = videoMime(options.format);
  if (!mimeType)
    throw Error(
      `${options.format.toUpperCase()} recording is unavailable in this browser. Try WebM.`,
    );
  if (signal.aborted)
    throw new DOMException('Recording cancelled', 'AbortError');
  const first = frame();
  const canvas = document.createElement('canvas');
  // Even dimensions are required by common MP4 encoders.
  canvas.width = Math.max(2, Math.ceil(first.width / 2) * 2);
  canvas.height = Math.max(2, Math.ceil(first.height / 2) * 2);
  const context = canvas.getContext('2d');
  if (!context || typeof canvas.captureStream !== 'function')
    throw Error('Canvas video recording is unavailable');
  context.drawImage(first, 0, 0, canvas.width, canvas.height);
  const stream = canvas.captureStream(30);
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 5_000_000,
    });
  } catch (error) {
    for (const track of stream.getTracks()) track.stop();
    throw error;
  }
  return new Promise((resolve, reject) => {
    const chunks: Blob[] = [];
    let bytes = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    let ending = false;
    const start = performance.now();
    function cleanup() {
      if (timer !== undefined) clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      for (const track of stream.getTracks()) track.stop();
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      if (recorder.state !== 'inactive') recorder.stop();
    }
    function fail(error: unknown) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    }
    function abort() {
      fail(new DOMException('Recording cancelled', 'AbortError'));
    }
    recorder.ondataavailable = (event) => {
      bytes += event.data.size;
      if (bytes > 100_000_000) {
        fail(Error('Video exceeds 100 MB; choose a shorter recording'));
        return;
      }
      if (event.data.size) chunks.push(event.data);
    };
    recorder.onerror = () =>
      fail(Error('Video encoder failed. Try a different recording format.'));
    recorder.onstop = () => {
      if (settled) return;
      if (!ending) {
        fail(Error('Video recorder stopped unexpectedly'));
        return;
      }
      const blob = new Blob(chunks, { type: recorder.mimeType || mimeType });
      if (!blob.size) {
        fail(Error('Video encoder produced no frames'));
        return;
      }
      settled = true;
      cleanup();
      resolve(blob);
    };
    function tick() {
      if (settled) return;
      try {
        const elapsed = performance.now() - start;
        if (elapsed >= options.duration * 1000) {
          ending = true;
          progress(100);
          recorder.stop();
          return;
        }
        context?.drawImage(frame(), 0, 0, canvas.width, canvas.height);
        progress(Math.floor(elapsed / (options.duration * 10)));
        if (!settled) timer = setTimeout(tick, 1000 / 30);
      } catch (error) {
        fail(error);
      }
    }
    signal.addEventListener('abort', abort, { once: true });
    try {
      recorder.start(1000);
      tick();
    } catch (error) {
      fail(error);
    }
  });
}
