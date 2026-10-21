# Project status

Last updated 2026-10-20. Keep this page short and current; append dated detail to [DEVELOPMENT_LOG.md](DEVELOPMENT_LOG.md).

## Where things stand

- **Alpha, feature-complete for milestones M1–M5** of the [implementation plan](../IMPLEMENTATION_PLAN.md). Optional M6 (free 3D orbit and placement) is deferred.
- **License:** MIT ([LICENSE](../LICENSE)). Bundled AWS and Kubernetes artwork keeps its own terms ([THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)).
- **Platform:** x86_64 Omarchy (validated on 4.0.4). Distribution is an Omarchy install bundle published as a GitHub Release asset; see [RELEASING.md](RELEASING.md).
- **Release:** 0.2.0 (2026-10-20) is the first public release, built in Docker with `scripts/docker-release.sh`. Changes are listed in [CHANGELOG.md](../CHANGELOG.md).

## Verification

| Check | Result | When |
| --- | --- | --- |
| Biome lint, strict TypeScript | Pass | 2026-10-20 |
| `bun test` | 100 tests / 1,274 assertions across 27 files | 2026-10-20 |
| Production build, initial JS budget | 233,122 bytes gzip / 358,400 budget | 2026-10-20 |
| Rust fmt, clippy (`-D warnings`), `cargo test`, release build | Pass (Docker release build) | 2026-10-20 |
| Native smoke diagnostics | Last passed after the performance pass | 2026-10-17 |

Native smoke diagnostics need a display and are not part of the Docker build; rerun them on the desktop.

## Performance

Measured on an Intel i9-11900H laptop with Intel UHD graphics through WebKitGTK. Raw data is in [benchmarks/results](../benchmarks/results/README.md).

| Measure | Latest result | Target |
| --- | --- | --- |
| 500-node pan, scheduled update p95 | 23–29 ms (1253×1376 window, 2026-10-17) | ≤ 33 ms |
| 2,000-node pan, scheduled update p95 | 32–41 ms (1253×1376 window, 2026-10-17) | — |
| 500-node board memory | 603 MiB summed RSS / 350 MiB PSS (2026-10-16, not remeasured since) | ≤ 250 MiB RSS |
| Idle rendering | Zero frames when nothing changes | Zero |

The pan result meets its target in the tested window but has not been repeated at the plan's 1920×1080 reference size. Memory remains above target.

## Open work

1. Install 0.2.0 on the desktop and rerun the native smoke diagnostics.
2. Remeasure memory and the 1920×1080 pan figures on the release build.
3. Hardware certification still outstanding: exact 60 Hz display, physical fractional-DPI scaling, cold-cache startup.
4. Optional: submit the package recipe to the [Omarchy Package Repository](https://github.com/omacom/omarchy-pkgs#contribute-a-package) so `omarchy pkg add solar-forge-diagrams` works.
