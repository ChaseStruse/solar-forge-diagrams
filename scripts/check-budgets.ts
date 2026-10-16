import { gzipSync } from 'node:zlib';

const html = await Bun.file('dist/index.html').text();
const entry = html.match(/src="([^"]+\.js)"/u)?.[1];
if (!entry || !entry.startsWith('/assets/'))
  throw new Error('Missing production JS entry');
const bytes = new Uint8Array(await Bun.file(`dist${entry}`).arrayBuffer());
const compressed = gzipSync(bytes).byteLength;
console.log(
  `Initial JavaScript: ${compressed.toLocaleString()} bytes gzip / 358,400 budget`,
);
if (compressed > 350 * 1024)
  throw new Error('Initial JavaScript exceeds the performance budget');
if (process.argv.includes('--native')) {
  const binary = Bun.file('src-tauri/target/release/solar-forge-diagrams');
  if (!(await binary.exists()))
    throw new Error('Build the release native binary first');
  console.log(
    `Native executable (bundled frontend included): ${binary.size.toLocaleString()} bytes / 31,457,280 budget`,
  );
  if (binary.size > 30 * 1024 * 1024)
    throw new Error('Native executable exceeds the app-owned package target');
}
