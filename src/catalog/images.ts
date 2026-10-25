import { type ComponentDefinition, services } from './services';
export const serviceImages = new Map<string, HTMLImageElement>();
const loading = new Map<string, Promise<void>>();
/**
 * Load the icons of the given catalog IDs (every icon when omitted). Each
 * file is fetched once, so a board only downloads the icons it shows.
 */
export function loadServiceImages(ids?: Iterable<string>): Promise<void> {
  const wanted = ids ? new Set(ids) : undefined;
  return Promise.all(
    services
      .filter((service) => service.icon && (!wanted || wanted.has(service.id)))
      .map(load),
  ).then(() => {});
}
/** Catalog IDs with icons that are not loaded or loading yet. */
export function missingServiceImages(ids: Iterable<string>): string[] {
  return [...new Set(ids)].filter((id) => !loading.has(id));
}
function load(service: ComponentDefinition): Promise<void> {
  let promise = loading.get(service.id);
  if (!promise) {
    promise = new Promise<void>((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        serviceImages.set(service.id, image);
        resolve();
      };
      image.onerror = () =>
        reject(Error(`Could not load ${service.label} icon`));
      image.src = service.icon ?? '';
    });
    loading.set(service.id, promise);
  }
  return promise;
}
