# Third-party software and artwork

The original application source license is described in SOURCE_LICENSE.md. The following components have separate licenses; their copyright/license texts must accompany redistribution. No artifacts have been published by this implementation.

- Three.js 0.183.2 — MIT, copyright Three.js authors. License: node_modules/three/LICENSE. https://github.com/mrdoob/three.js
- Tauri JavaScript API 2.10.1 and Rust core 2.12.4 — MIT OR Apache-2.0. https://github.com/tauri-apps/tauri
- Tauri dialog plugin 2.8.3 — MIT OR Apache-2.0. https://github.com/tauri-apps/plugins-workspace
- Tauri single-instance plugin 2.5.4 — MIT OR Apache-2.0. https://github.com/tauri-apps/plugins-workspace
- AWS Architecture Icons — copyright Amazon Web Services, Inc. and/or its affiliates; separate asset-use terms. See assets/aws/NOTICE.md and manifest.json.

Rust transitive dependencies are locked in src-tauri/Cargo.lock. Toolchain dependencies (Bun, Vite, TypeScript, Biome, Cargo) are used during development and are not required to launch the installed application. Shared system GTK/WebKitGTK/portal libraries are supplied and licensed by the operating system. The package build runs scripts/collect-licenses.py to collect unmodified license texts for all normal-target Rust dependencies and Three.js. Four crate archives omit their license texts; pinned upstream/canonical copies are retained in packaging/licenses with provenance in its README. Collection fails if another required text is missing.
