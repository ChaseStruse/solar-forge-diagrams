# Third-party software and artwork

Solar Forge Diagrams source code is released under the MIT License (see LICENSE). The following components have separate licenses; their copyright/license texts must accompany redistribution.

- yaml 2.9.1 — ISC, copyright Eemeli Aro. License: node_modules/yaml/LICENSE. https://github.com/eemeli/yaml
- Three.js 0.183.2 — MIT, copyright Three.js authors. License: node_modules/three/LICENSE. https://github.com/mrdoob/three.js
- Tauri JavaScript API 2.10.1 and Rust core 2.12.4 — MIT OR Apache-2.0. https://github.com/tauri-apps/tauri
- Tauri dialog plugin 2.8.3 — MIT OR Apache-2.0. https://github.com/tauri-apps/plugins-workspace
- Tauri single-instance plugin 2.5.4 — MIT OR Apache-2.0. https://github.com/tauri-apps/plugins-workspace
- AWS Architecture Icons — copyright Amazon Web Services, Inc. and/or its affiliates; separate asset-use terms. See assets/aws/NOTICE.md and manifest.json.

Rust transitive dependencies are locked in src-tauri/Cargo.lock. Toolchain dependencies (Bun, Vite, TypeScript, Biome, Cargo) are used during development and are not required to launch the installed application. Shared system GTK/WebKitGTK/portal libraries are supplied and licensed by the operating system. The package build runs scripts/collect-licenses.py to collect unmodified license texts for all normal-target Rust dependencies and Three.js. Four crate archives omit their license texts; pinned upstream/canonical copies are retained in packaging/licenses with provenance in its README. Collection fails if another required text is missing.

- Kubernetes resource icons — official Kubernetes community icon set, distributed under Apache-2.0 (upstream also offers CC-BY-4.0). Unmodified assets, license, upstream README, and pinned source hashes are in assets/kubernetes/. See assets/kubernetes/NOTICE.md.
- VT323 font — copyright 2011 The VT323 Project Authors, SIL Open Font License 1.1. Unmodified Latin subset, license and hash in assets/fonts/. See assets/fonts/NOTICE.md.
