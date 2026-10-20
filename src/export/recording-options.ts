/** Recording settings, kept apart so the editor need not load the encoder. */
export interface RecordingOptions {
  duration: number;
  dither: boolean;
}
export const defaultRecordingOptions: RecordingOptions = {
  duration: 12,
  dither: true,
};
export function validateRecordingOptions(
  options: RecordingOptions,
): RecordingOptions {
  if (
    !Number.isInteger(options.duration) ||
    options.duration < 2 ||
    options.duration > 120 ||
    typeof options.dither !== 'boolean'
  )
    throw Error('GIF duration must be a whole number from 2 to 120 seconds');
  return { ...options };
}
