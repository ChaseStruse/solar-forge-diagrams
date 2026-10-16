# Solar Forge Diagrams alpha

Open the native application from its launcher or open a `.sforge.json` diagram in the file manager. It works offline and does not need an account, credentials, Docker or a local server.

Use the file menu for New, Open, Save, Save As, recent diagrams, architecture templates and PNG/SVG export. Choose Plan for precise top-down editing or 2.5D for raised architecture tiles. Fit brings the complete diagram into view; scroll zooms around the pointer. Right-drag or the Pan tool moves the view. Quality settings are in keyboard help.

Open Components (`/`) to find flowchart shapes, AWS services or architecture boundaries. Search service abbreviations, categories and aliases such as `k8s`, `queue` or `database`. Added components occupy free slots. Click a component or a Layers row to select it; Shift-click adds/removes selection and Ctrl+A selects the board. Drag selected components, or use arrow keys to nudge (Shift for larger steps). Snap toggles the ten-unit grid.

Use the lower-right handle to resize the selected component, or edit dimensions/position in the properties panel. Edit its label there; AWS service identity and official icon remain intact when renaming. The diagram title at the top is editable. Architecture details include region, environment, resource name, tags and notes.

Ctrl+G groups the selection; Ctrl+Shift+G ungroups. Parent coordinates and world positions are preserved. You can also choose an existing boundary in the inspector. Layers shows the nested hierarchy. Ctrl+D duplicates; Ctrl+C/X/V copies/cuts/pastes graph fragments and their internal connections. Delete removes selected nodes and incident edges. A selected boundary includes its children. Right-click opens selection actions.

Choose Connect (`C`), then a source and target on the canvas, or drag a port dot to a target. Named north/east/south/west ports remain separate from labels. Select a connection in Layers to rename it, reconnect either endpoint/port, change its orthogonal routing axis or adjust bend offset. Delete connection removes only that edge. Routing is deterministic orthogonal routing; automatic obstacle avoidance is not included.

Ctrl+Z undoes a complete gesture; Ctrl+Shift+Z or Ctrl+Y redoes it. Input fields retain normal text undo. Ctrl+K searches commands and components. Escape cancels an in-progress gesture or tool and closes popovers.

Save (`Ctrl+S`) chooses a destination once, then reuses it. Save As (`Ctrl+Shift+S`) selects a new destination. Closing/replacing unsaved work offers Save, Discard and Cancel. Recovery is debounced and does not overwrite the chosen file; restart offers to recover an interrupted session. See DOCUMENTS.md for limits and failure behavior.

PNG captures the current view, including all rendered text and icons. SVG is a separate, self-contained light top-down document export with embedded official service icons. SVG does not reproduce the shaded spatial camera. For large diagrams use Fit or select an appropriate zoom before PNG export.

## Accepted alpha limitations

This is an alpha, not a production performance certification. On the tested machine the 500-node board uses approximately 603 MiB summed process RSS / 350 MiB PSS and scheduled pan updates have approximately 49 ms p95 latency at a 1920×1080 window. The user explicitly accepted these limitations for the alpha; the original 250 MiB / 33 ms targets remain future goals. Stress boards are slower. See benchmarks/results/2026-10-16-alpha-native.json and docs/PROGRESS.md for exact context/accounting. The configured monitor was 120 Hz; exact 60 Hz, true cold-cache startup and physical fractional-DPI release certification remain follow-ups. No display configuration was changed.

Automatic layout, obstacle avoidance, unrestricted 3D orbit/elevation, live AWS discovery, cloud sync and collaboration are outside this alpha. The plan's M6 3D exploration remains optional/deferred.
