import { services } from './services';
export const serviceImages = new Map<string, HTMLImageElement>();
let loading: Promise<void> | undefined;
export function loadServiceImages(): Promise<void> {
  loading ??= Promise.all(
    services
      .filter((service) => service.icon)
      .map(
        (service) =>
          new Promise<void>((resolve, reject) => {
            const image = new Image();
            image.onload = () => {
              serviceImages.set(service.id, image);
              resolve();
            };
            image.onerror = () =>
              reject(Error(`Could not load ${service.label} icon`));
            image.src = service.icon ?? '';
          }),
      ),
  ).then(() => {});
  return loading;
}
