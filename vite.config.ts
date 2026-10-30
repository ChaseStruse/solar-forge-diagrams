import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // The full AWS icon set would bloat the initial script if inlined; ship
    // each icon as its own file so a board loads only the icons it shows.
    assetsInlineLimit: (file) =>
      file.includes('/assets/aws/') ? false : undefined,
  },
});
