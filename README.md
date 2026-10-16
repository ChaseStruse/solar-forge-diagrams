# Solar Forge Diagrams

Native, offline-first architecture diagramming with a Three.js isometric canvas and a small Tauri shell. Implementation follows [the plan](IMPLEMENTATION_PLAN.md); see [progress and commit mapping](docs/PROGRESS.md).

## Development

Install Bun 1.3.11 and a stable Rust toolchain, plus the Tauri Linux prerequisites (WebKitGTK 4.1 and GTK 3 development libraries).

```sh
bun install --frozen-lockfile
bun run check
bun test
bun run build
bun run desktop
```

`bun run dev` previews portable UI work in a browser. Native validation requires `bun run desktop`; browser checks cannot certify Tauri or GPU compatibility. Production uses bundled assets and needs no server or Docker runtime.
