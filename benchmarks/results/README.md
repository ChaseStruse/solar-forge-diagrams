# Native measurement records

These are preliminary runs, not release certification. The JSON identifies viewport, build mode, texture/draw counts, and CPU-side rendering measurements. Camera-change-to-frame timings do not measure physical input latency or GPU completion.

The `release-single-group` run used the earlier fixture with one root group. The current fixture adds three nested boundaries at the same total node/edge counts; repeat measurement before comparing results. It used a 1046×918 window at DPR 1 on Omarchy / WebKitGTK 2.52.6. WebGL reported `Apple GPU` despite Linux Intel/NVIDIA hardware; treat these privacy-masked strings as unverified, not an identified active GPU.

Hardware inventory: Intel i9-11900H, 16 GB system RAM, Intel UHD + NVIDIA RTX 3060 Mobile. CPU/RSS, driver selection, physical latency, repeated warm/cold startup, and the 1920×1080 reference run remain to be measured. `navigationToScriptMs` starts at web navigation, not process launch.

The `release-nested-groups` run uses the corrected three-boundary fixture and portal backend from `57cc746`. Window size was 900×918, DPR 1. It reports 151 ms standard-board load, 4 ms render-submission p95, and 19 ms scheduled camera-update-to-frame p95. The smaller window and updated fixture prevent a controlled comparison with the earlier run. See `docs/STATUS.md` for current figures and open acceptance measurements.

## Accepted alpha measurements — 2026-10-16

The current optimized native run is `2026-10-16-alpha-native.json`: 1920×1080, DPR 1, configured 120 Hz display. Standard 500/750 board: 170 ms load, 5 ms pan submission p95, 49 ms scheduled pan-update p95, 23 draws. Stress 2000/3000: 639 ms load, 12 ms submission p95, 93 ms scheduled update p95, 67 draws. Idle invalidation, repeated scene texture counts, context restoration and editing diagnostics pass. The explicit two-second test-window sizing delay is included in navigation-to-diagnostics and is not a startup metric.

`2026-10-16-resource-after-tuning.json` measures the actual standard-board UI: 0.85 s process-to-opened status (includes accessibility polling), 0.90% normalized CPU over 30 seconds, 603.11 MiB summed process-tree RSS / 350.15 MiB PSS. Summed RSS counts shared mappings in multiple processes; PSS apportions them. Neither measures GPU allocations. Active device is Intel i915 `/dev/dri/renderD129`.

The user accepted memory and scheduled-input misses as alpha limitations. The 250 MiB RSS / 33 ms targets remain unmet. Exact 60 Hz, physical high-DPI, cold-cache launch trials and physical input/GPU timing remain follow-up certification. Earlier results are historical and are not controlled comparisons.
