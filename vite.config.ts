import { readdirSync, readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

/**
 * Ship the AWS icons at fixed paths (assets/aws/<file>.svg, as the dev server
 * serves them) so the catalog builds each URL instead of carrying a table of
 * hashed names. Each icon is its own file: a board loads only what it shows.
 */
const awsIcons = {
  name: 'aws-icons',
  apply: 'build' as const,
  generateBundle(this: {
    emitFile(file: { type: 'asset'; fileName: string; source: Buffer }): void;
  }) {
    for (const file of readdirSync('assets/aws'))
      if (file.endsWith('.svg'))
        this.emitFile({
          type: 'asset',
          fileName: `assets/aws/${file}`,
          source: readFileSync(`assets/aws/${file}`),
        });
  },
};

export default defineConfig({ plugins: [awsIcons] });
