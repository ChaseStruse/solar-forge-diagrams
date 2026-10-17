# Native memory and invalidation

Native standard-board measurement found approximately 602 MiB summed process-tree RSS and 348 MiB proportional set size, above the initial 250 MiB RSS target. RSS sums shared GTK/WebKit mappings across processes; PSS apportions shared pages. Neither is a GPU-allocation measurement. The application must report both and must not claim the memory target passed by substituting PSS.

Avoid rebuilding the Layers DOM on selection/position-only changes. Cache the list's structural signature, preserve row/focus objects, and update selection state in place. Display nested parents explicitly and use indexed endpoint-name lookups rather than repeated whole-node scans.

The renderer always draws an opaque backdrop, so its WebGL drawing buffer does not require an alpha channel. Use an opaque drawing buffer; PNGs still contain the intended background.

On Linux configure WebKit's `DocumentViewer` cache model for this single bundled application page. WebKit's default `WebBrowser` policy retains caches meant for browsing history; this app does not navigate among websites. Official API rationale: https://webkitgtk.org/reference/webkit2gtk/stable/method.WebContext.set_cache_model.html . Access uses a pinned direct reference to webkit2gtk 2.0.2, already in the locked Tauri dependency graph; it adds no new native library or frontend dependency. Its existing license is covered by the dependency-notice collector. Do not change WebKit's security process isolation.

Repeat native resource and latency measurements after these changes. The initial budgets remain in force. A process-local DMA-BUF compatibility-path experiment is diagnostic only; do not alter global desktop/driver environment or silently ship a workaround based on one run.

After tuning, the standard board measured 603.11 MiB summed RSS / 350.15 MiB PSS and 49 ms scheduled pan-update p95 at 1920×1080, DPR 1, on the configured 120 Hz display. The changes did not meet the original memory/input targets. The user accepted these measured misses as documented alpha limitations on 2026-10-16; original targets remain follow-up work. Raw reports are retained in `benchmarks/results/`.
