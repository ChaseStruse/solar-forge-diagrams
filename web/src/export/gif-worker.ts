import { GifEncoder } from './gif';

let encoder: GifEncoder | undefined;
self.onmessage = (event: MessageEvent) => {
  try {
    const message = event.data;
    if (message.type === 'frame') {
      encoder ??= new GifEncoder(message.width, message.height, message.dither);
      encoder.addFrame(new Uint8ClampedArray(message.buffer), message.delay);
      self.postMessage({});
    } else if (message.type === 'finish') {
      if (!encoder) throw Error('No GIF frames');
      self.postMessage({ blob: encoder.finish() });
    }
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
