# Solar Forge Diagrams alpha

Open the native application from its launcher or open a `.sforge.json` diagram in the file manager. It works offline and does not need an account, credentials, Docker or a local server.

Use the file menu for New, Open, Save, Save As, recent diagrams, architecture templates and PNG/SVG export. Choose Plan for precise top-down editing or 2.5D for raised architecture tiles. Fit brings the complete diagram into view; scroll zooms around the pointer. Right-drag or the Pan tool moves the view. Quality settings are in keyboard help.

Open Components (`/`) to find flowchart shapes, AWS services, actors (User, Internet), text, sticky notes or architecture boundaries. Search service abbreviations, categories and aliases such as `k8s`, `queue` or `database`; the first match is highlighted, arrows move the highlight and Enter drops it on the board in a free slot near the centre of the view. Service tiles use the official AWS colour of their category, matching the icon. Click a component or a Layers row to select it; Shift-click adds/removes selection and Ctrl+A selects the board. In Select mode, left-drag empty canvas to draw a selection rectangle; Shift-drag adds to the existing selection. Drag either direction. An unselected boundary's interior also supports rectangle selection; click it to select the boundary, then drag to move it. Drag selected components, or use arrow keys to nudge (Shift for larger steps). Snap toggles the ten-unit grid. While dragging, smart guides pull edges and centres into line with nearby tiles and show a dashed guide; hold Ctrl to place freely. Right-click a multi-selection (or use Ctrl+K) to align left/centre/right/top/middle/bottom or distribute evenly.

A single selected tile shows square resize handles on its corners and sides; the opposite edge stays put (children of a boundary stay in place). The round dots just outside each side are connection ports. You can also edit dimensions, position and colour in the properties panel. Double-click a tile (or press Enter) to rename it in place; AWS service identity and official icon remain intact when renaming. The diagram title at the top is editable. Architecture details include region, environment, resource name, tags and notes.

Ctrl+G groups the selection; Ctrl+Shift+G ungroups. Parent coordinates and world positions are preserved. You can also choose an existing boundary in the inspector. Layers shows the nested hierarchy. Ctrl+D duplicates; Ctrl+C/X/V copies/cuts/pastes graph fragments and their internal connections. Delete removes selected nodes and incident edges. A selected boundary includes its children. Right-click opens selection actions.

Choose Connect (`C`), then a source and target on the canvas (sides are chosen automatically), or drag a port dot onto a target: the connection attaches to the side of the target nearest where you let go. Click a connection on the canvas (it highlights on hover) or in Layers to select it; Delete or right-click → Delete removes it, and double-clicking it edits its label. The inspector reconnects either endpoint, pins a side or returns it to Auto, changes the routing axis or adjusts bend offset. Routes are orthogonal and steer around tiles where a short detour exists.

Flow (view dock) animates data moving along every connection; turn it off for a static board. Journey (`P`) walks a person through the architecture: it starts at the selected tile, or at every User/Internet actor, or at every tile with no incoming arrow, follows each arrow once per lap, splits at forks, ripples each service it reaches and names the current hop in the status bar. P or Esc stops it.

Forks and decisions: select a tile with two or more outgoing arrows and choose "Journey at this fork" in the inspector. "Takes every branch" splits the traveler, "Asks me which way" pauses it there and shows a chooser (click a branch or press 1–9), and "Always → …" follows one branch only. Flowchart Decision shapes ask by default. Name the arrows (for example Yes/No) and those names appear in the chooser. Because you choose each time, a branch may loop back for retries. Connections that share a side of a tile fork from, or merge into, that tile.

Active routes: right-click an arrow that leaves a fork and choose Make active route (or use the buttons in the connection inspector). The other branches of that fork, and anything only they lead to, dim and stop flowing; the journey follows the active route. Show all routes switches the fork back.

Copy image (top bar, or Ctrl+Shift+C) puts a sharp picture of the whole diagram on the clipboard, cropped to its content regardless of pan, zoom or open panels, ready to paste into chat, docs or slides. The native app uses `wl-copy` on Wayland (part of Omarchy) or `xclip` on X11.

Text (`T`) and Sticky note (`N`) place an annotation where you click; double-clicking empty board also starts a text. Type, then Ctrl+Enter or click away to finish; Esc cancels a new annotation. Text wraps inside its box; resize the box or change Text size in the inspector. Notes take any colour.

The palette button in the top bar switches theme: Cyberpunk (default), Solar Forge, Nord or Daylight. The choice, Flow and render quality are remembered on this machine.

Ctrl+Z undoes a complete gesture; Ctrl+Shift+Z or Ctrl+Y redoes it. Input fields retain normal text undo. Ctrl+K searches commands and components. Escape cancels an in-progress gesture or tool and closes popovers.

Save (`Ctrl+S`) chooses a destination once, then reuses it. Save As (`Ctrl+Shift+S`) selects a new destination. Closing/replacing unsaved work offers Save, Discard and Cancel. Recovery is debounced and does not overwrite the chosen file; restart offers to recover an interrupted session. See DOCUMENTS.md for limits and failure behavior.

PNG captures the current view, including all rendered text and icons. SVG is a separate, self-contained light top-down document export with embedded official service icons. SVG does not reproduce the shaded spatial camera. For large diagrams use Fit or select an appropriate zoom before PNG export.

## Accepted alpha limitations

This is an alpha, not a production performance certification. On the tested machine the 500-node board uses approximately 603 MiB summed process RSS / 350 MiB PSS and scheduled pan updates have approximately 49 ms p95 latency at a 1920×1080 window. The user explicitly accepted these limitations for the alpha; the original 250 MiB / 33 ms targets remain future goals. Stress boards are slower. See benchmarks/results/2026-10-16-alpha-native.json and docs/PROGRESS.md for exact context/accounting. The configured monitor was 120 Hz; exact 60 Hz, true cold-cache startup and physical fractional-DPI release certification remain follow-ups. No display configuration was changed.

Automatic layout, unrestricted 3D orbit/elevation, live AWS discovery, cloud sync and collaboration are outside this alpha. The plan's M6 3D exploration remains optional/deferred.

## Text, containers, and networking journeys

Service and flowchart components start as the same **160 × 100** grid-aligned rectangle. Boundaries and annotations retain sizes suited to their contents. Text and sticky notes wrap and automatically reduce their font size until all text fits; resizing scales the preferred size with the box. Service captions scale with tile width and fit within that width. PNG, SVG, and GIF exports retain the fitted text.

Search **Components** for Docker, Container, Container image, GitHub Actions, Git repository, CI/CD pipeline, Internet gateway, NAT gateway, Security group, or Route table. These are bundled original pictograms and work offline.

Open the file menu and choose **VPC · public and private subnets** for a two-availability-zone layout with public EC2 instances and private databases, or **Networking journey demo** for public ingress, private NAT egress, and explicitly blocked internet-to-database paths.

Use **Traffic** next to Journey to set the journeyman's protocol, destination port, source IPv4 address, and direction. Select a connection and expand **Journey traffic rule** to permit matching traffic, deny traffic, or leave the connection unrestricted. Matching supports a single port, protocol, source CIDR, and direction per connection; blank port/CIDR and Any selectors match all values. ICMP ignores ports. A denied attempt flashes red at the source and stops on that connection; the status line explains why. Other allowed branches continue. Traffic settings and rules save with the diagram and support undo/redo.

In the networking demo, the default TCP/443 ingress request can enter the public tier, while direct access to private databases is denied. To explore private egress, select **Private worker A**, set source `10.0.10.10` and direction **Egress**, then play Journey. Use a different port or source subnet to see the NAT connection reject the request. These rules illustrate configured paths; they do not calculate AWS route tables, security-group state, NACLs, address translation, or return traffic.

Choose **Export journey GIF** from the file menu (also available in Ctrl+K commands). It records the current view for **12 seconds at 8 fps**, up to **640 × 480**, with an offline 256-color palette and a repeating loop. Frame captures include the journeyman, pulses, and flow animation. Select a start node before export to focus the journey. Decision prompts take their first branch during recording; fixed routes are respected. Editing pauses while recording; press **Esc** to cancel. The native app opens a GIF save dialog; browser previews download `journey.gif`. Longer journeys may extend beyond the recording window.
