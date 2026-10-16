# 0001: Native rendering and toolchain foundation

Accepted for M0, 2026-10-15.

Use plain TypeScript/DOM and Three.js inside Tauri. Runtime JavaScript dependencies are Three.js (MIT, scene rendering) and the Tauri API (MIT/Apache-2.0, native IPC); neither React nor a reactive UI store is needed for the initial workspace. Alternatives considered: PixiJS lacks the intended native 3D scene model; React adds a UI layer the user explicitly wants to avoid. Licenses are shipped in dependency packages and require inclusion in final release notices at M5.

Versions are exact in package.json and bun.lock. Rust uses Cargo.lock. Revisit dependency freshness before release; these deliberately pinned known versions are not a claim to be the latest available. Initial measured frontend gzip is approximately 134 kB, including the renderer, far below the 350 KiB budget. The >500 kB uncompressed Vite advisory remains visible; do not hide it by raising the threshold.

Native file commands choose paths inside Rust dialogs. The frontend receives content, not unrestricted filesystem APIs. Atomic writes occur in the selected file's directory, sync before replacement, and preserve complete documents on a failed replacement. Native tests exercise the writer. M1 must add recovery/autosave and persistent document handles; M0 Save currently asks for a destination each time.

The native binary defaults to Tauri's custom-protocol feature so direct Cargo builds load bundled files. Tauri CLI development mode uses its development server. Do not certify offline behavior by launching a dev-server-backed window.

M0 diagnostics run only when a debug shell is explicitly launched with --smoke-test. They are lazy-loaded, use a fixed temporary output directory, and never write user documents. They measure CPU-side render submission and scheduled camera updates, not GPU completion or physical latency. Release benchmarks and manual dialogs/scaling/clipboard checks are still required.

Performance follow-up: readable edge labels increased the object/draw count enough to miss the standard frame-time target. Share text atlas images and batch billboard labels per atlas page. Batch connector segments into one dynamic geometry; changing a node updates only its incident edge buffer ranges. This reduces draw calls without adding a rendering dependency or changing document semantics. Keep exported labels inside the same WebGL scene.

Wayland dialog follow-up: the default GTK file chooser tiled as an independent, undersized window on this Omarchy session; setting its parent alone did not correct the behavior. Select the dialog plugin's XDG portal backend and retain explicit parent handles. This adds native Rust portal dependencies (no new frontend packages) to integrate with the existing desktop file chooser. Re-measure native executable size and validate the actual chooser before calling this fixed. The Arch package will need an installed desktop portal and a file-chooser backend.
