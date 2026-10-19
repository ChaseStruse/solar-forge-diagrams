# Solar Forge Diagrams alpha

Open the native application from its launcher or open a `.sforge.json` diagram in the file manager. It works offline and does not need an account, credentials, Docker or a local server.

Use the file menu for New, Open, Save, Save As, recent diagrams, architecture templates and PNG/SVG export. Choose Plan for precise top-down editing or 2.5D for raised architecture tiles. Fit brings the complete diagram into view; scroll zooms around the pointer. Right-drag or the Pan tool moves the view. Quality settings are in keyboard help.

Choose **Examples → AWS → Data pipelines → Data Pipeline Example** for an editable e-commerce pipeline: DynamoDB → Kinesis Data Streams → Data Firehose, Lambda transformation, CSV delivery to S3, Glue Data Catalog, SageMaker AI recommendations, and Athena ad-hoc queries. The example includes customers, an ML engineer, and a data scientist. Its AWS icons are bundled for offline use.

Choose **Examples → AWS → Security → security demo** for IAM user/group membership, an ELB read-only group policy, and an EC2 instance role with scoped S3 read permissions. The network path is Internet → ELB (Application Load Balancer) → private EC2 application → private PostgreSQL. Three attached security groups restrict each hop. Select its saved **Traffic** scenarios to check allowed HTTPS/443, application/8080, and database/5432 flows, or denied direct Internet database access, ELB database bypass, and SSH. Each scenario checks one connection with its own destination port; a load balancer opens a new target connection. Edit a security-group rule and rerun the check to see its effect.

IAM relationships are illustrative dependencies and are excluded from network journeys; IAM policy evaluation and S3 access are not simulated. The ALB is a logical endpoint: the second availability-zone subnet, target group, TLS certificate and health checks are omitted. Subnet ACLs use the checker's default allow assumption. See AWS documentation on [IAM policies](https://docs.aws.amazon.com/IAM/latest/UserGuide/introduction_access-management.html), [EC2 instance roles](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use_switch-role-ec2.html), and [ALB security groups](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-update-security-groups.html).

Open **Examples** in the top bar, **File menu → Browse examples…**, or search for **Browse examples** in the command palette (`Ctrl+K`). The browser groups diagrams by category and subcategory, shows a short description for each, and includes at least two examples in every subcategory. Search names, descriptions, or category terms such as `AWS security`, `NAT`, `IAM`, or `approval`. Search works within the selected category; choose **All examples** to search the whole library. Press Enter in search to open the first result, or Tab to a card and press Enter. Escape or Close returns to your diagram. Opening an example preserves the usual unsaved-change prompt.

| Category | Subcategory | Examples |
| --- | --- | --- |
| AWS | Security | security demo; Private worker egress |
| AWS | Networking | VPC · public and private subnets; Networking journey demo |
| AWS | Applications | Two-service starter; Serverless API; Three-tier application |
| AWS | Data pipelines | Data Pipeline Example; Event pipeline |
| AWS | Containers | Container service; Container image delivery |
| Kubernetes | Applications | Kubernetes · web application; Internal service communication |
| General | Flowcharts | Simple flowchart; Approval workflow |

The private worker example includes saved Traffic scenarios for allowed outbound HTTPS and denied SSH/inbound access. Container image delivery distinguishes build/deploy dependencies from web requests. Internal Kubernetes communication shows frontend-to-backend service routing. Approval workflow includes approve/revise branches and a revision loop for trying Journey decisions.

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

Unrestricted 3D orbit/elevation, live AWS discovery, cloud sync and collaboration remain outside this alpha. Offline infrastructure imports and automatic layout are available in the file menu. The plan's M6 3D exploration remains optional/deferred.

## Text, containers, and networking journeys

Service and flowchart components start as the same **160 × 100** grid-aligned rectangle. Boundaries and annotations retain sizes suited to their contents. Text and sticky notes wrap and automatically reduce their font size until all text fits; resizing scales the preferred size with the box. Service captions wrap across multiple lines within the tile width, using the same fitting logic as text boxes. PNG, SVG, and GIF exports retain the fitted text.

Search **Components** for Docker, Container, Container image, GitHub Actions, Git repository, CI/CD pipeline, Internet gateway, NAT gateway, Security group, Network ACL, or Route table. These are bundled original pictograms and work offline, with individual colours such as Docker blue, GitHub dark grey, and Git orange.

Open the file menu and choose **VPC · public and private subnets** for a two-availability-zone layout with public EC2 instances and private databases, or **Networking journey demo** for public ingress, private NAT egress, and explicitly blocked internet-to-database paths.

Use **Traffic** next to Journey to set the journeyman's protocol, destination port, source IPv4 address, and direction. Select a connection and expand **Journey traffic rule** to permit matching traffic, deny traffic, or leave the connection unrestricted. Matching supports a single port, protocol, source CIDR, and direction per connection; blank port/CIDR and Any selectors match all values. ICMP ignores ports. A denied attempt flashes red at the source and stops on that connection; the status line explains why. Other allowed branches continue. Deny and Unrestricted disable the match fields because those actions ignore them; Deny always blocks the connection. Traffic settings and rules save with the diagram and support undo/redo.

In the networking demo, the default TCP/443 ingress request can enter the public tier, while direct access to private databases is denied. To explore private egress, select **Private worker A**, set source `10.0.10.10` and direction **Egress**, then play Journey. Use a different port or source subnet to see the NAT connection reject the request. These rules illustrate configured paths; they do not calculate AWS route tables, security-group state, NACLs, address translation, or return traffic.

Choose **Export journey GIF** from the file menu (also available in Ctrl+K commands), set a duration from **2 to 120 seconds**, and press **Record GIF**. The duration and dithering preference are remembered on this device. Export captures the current view at **up to 8 fps**, up to **640 × 480**, as a repeating loop. An image-adaptive 256-colour palette preserves themed backgrounds; **Dither gradients** enables Floyd–Steinberg error diffusion to soften colour bands. The palette stays stable during recording and reserves colours for journey markers. Encoding runs in a worker so it does not block journey playback. Frame delays follow actual capture times: slower machines produce fewer frames while preserving the selected duration and playback speed. Exports are limited to 49 MB; shorten the duration if that limit is reached.

Frame captures include the journeyman, pulses, and flow animation. Select a start node before export to focus the journey, and choose a duration long enough for its route. Decision prompts take their first branch during recording; fixed routes are respected. Editing pauses while recording; press **Esc** to cancel. The native app opens a GIF save dialog; browser previews download `journey.gif`. Native GIF exports use [Tauri's raw binary request body](https://v2.tauri.app/develop/calling-rust/#accessing-raw-request) instead of a JSON array of numbers.


## Import existing infrastructure

Choose **File menu → Import infrastructure…**. Select multiple `.tf` files from the same root module together, or choose one `terraform show -json` output, CloudFormation YAML/JSON template, or Docker Compose YAML file. You can also paste code; the format selector can override detection. **Preview import** shows resource/boundary counts and warnings before **Import diagram** replaces the board. Import is an undoable replacement of the current board; Undo restores its previous contents and the rest of the project stays intact. Parsing, validation and layout run in a dedicated offline worker. Close the importer or edit the input to cancel an in-progress preview; stale results cannot be applied.

Everything runs locally. Import never runs Terraform, Docker, shell code, CloudFormation transforms, providers, or remote module downloads. It retains the resource properties needed for diagramming and network checks, rather than copying whole state records, environment variables, or user-data scripts into the diagram. Limits are 256 selected files, 50 MB of source, 5000 AWS resources or 2000 Compose services, and the existing portable document limits.

- **Terraform HCL:** imports resource blocks, literals, resource references, variable defaults, simple locals, and literal `count` up to 100. Choose the related files together. Functions, remote/local module expansion, dynamic blocks and `for_each` are not evaluated. Comprehensions and interpolated function calls are retained as unsupported expressions; affected resources are marked incomplete. Invalid or unresolved CIDRs, firewall ports and ACL priorities produce warnings and omit the unsafe rule. Counts outside 0–100 produce one incomplete, unexpanded resource placeholder. Warnings identify unresolved settings. Use evaluated `terraform show -json` output for expanded modules and instances. State and plan JSON include nested `child_modules`; plan configuration references recover unknown resource IDs where possible.
- **CloudFormation:** imports EC2 networking resources, security groups, ACL entries/associations, route tables/routes/associations, gateway attachments, and common AWS services. JSON `Ref` / `Fn::GetAtt` and YAML `!Ref` / `!GetAtt` references are supported, as are parameter defaults. Conditions, macros, other intrinsic calculations and external stack imports are not evaluated.
- **Compose:** imports services, dependency arrows, network boundaries and multiple network attachments. Services on a shared network can communicate in the static network model; services without a shared network are isolated. Host networking, container-sharing network modes, listener configuration and host port/firewall reachability are not simulated. Image names and published ports are shown as architecture notes; build instructions are never executed.

Start with the files in [examples/infrastructure](../examples/infrastructure): `vpc.tf`, `cloudformation.yaml`, and `docker-compose.yaml`. AWS imports include one Internet actor outside the resource boundaries for external reachability checks, without inventing connections or permissions. Unsupported AWS resource types remain as generic labeled boxes. Missing addresses and unsupported network settings can be completed in **Resource networking** before checking flows. Incomplete imported settings remain marked until you explicitly confirm you have supplied them.

## Tidy a board

Choose **File menu → Automatic layout** or find it with Ctrl+K. The engine packs the innermost groups first, resizes their parents, and layers sibling components using their connections. Region → VPC → availability zone → subnet containment is retained. Siblings get space for captions, dimensions of service boxes are preserved, and cyclic connections share a final layer without overlapping boxes. Layout is deterministic and undoable. Existing manual port/bend overrides are cleared so connections route against the new positions. This does not guarantee that every connector or connector label is free of crossings on a dense board.

## Attach network policies and check reachability

Select a resource and expand **Resource networking**. Enable its network model, enter known IPv4 addresses, and attach one or more security groups. Set the VPC CIDR on its VPC boundary. On a subnet, assign its route table and network ACL. Security-group, Network ACL and route-table components start with an empty policy; choose **Policy on this resource** on another component to give it a policy. Add rows and use **Apply resource networking**. These edits, assignments and imported policies save with the diagram and support undo/redo.

Security groups contain allow rules only. An attached group must allow source egress and another attached group must allow destination ingress; matching any group in each direction is sufficient. Rules match protocol, a port range, and a CIDR or peer security-group ID. Empty security-group rules deny that direction. Replies are treated as stateful. An AWS workload without modeled security groups yields Unknown.

ACLs apply at subnet boundaries. Rules use ascending numeric priority, first matching rule wins, and no match denies. Both request and return directions are checked; the default reply port is 49152 and can be changed in the matrix. An unassigned ACL assumes the default allow ACL. The decision trace states this assumption. ACLs do not filter traffic between endpoints in the same subnet.

Route lookup uses the longest matching IPv4 prefix plus the VPC's implicit local route. Blackhole routes deny. Public ingress requires public addressing and an internet-gateway return path; NAT cannot accept unsolicited inbound traffic. Private internet egress can follow a NAT gateway whose subnet routes onward to the VPC's internet gateway. Routes in both directions are checked for same-VPC connections.

Open **File menu → Reachability matrix…**. Choose a source, destination, protocol, destination port, external source-IP fallback and reply source port. **Check flow** gives **Allowed**, **Denied**, or **Unknown** with decision details. Existing diagrams need resource networking enabled before their arrows can be evaluated as network reachability. **Refresh matrix** compares all visible resource pairs; source and destination pages advance independently for larger diagrams. Select a cell to inspect it. **Trace journey** animates the modeled gateway path, or shows a denied attempt. This trace adds no saved arrows. Infrastructure reference/dependency arrows are not interpreted as network permission or journey branches. Ordinary user flow arrows retain their connection rules and also check attached resource policies when present.

The supplied Terraform example allows **HTTPS web → Private PostgreSQL** on TCP/5432 using a security-group peer rule, and denies TCP/22. Change a rule or the port and check again. Missing addresses, unresolved source values, incomplete policy references, IPv6, prefix lists, peering, transit gateways, interface endpoints, appliance routing, ICMP type/code restrictions, application listeners, DNS and load-balancer behavior are outside this static IPv4 evaluator. Unsupported paths return Unknown where modeled; this is an offline model check, not an AWS Reachability Analyzer or a deployment verification.

Manually attached resource policies also constrain Compose flows on shared networks. A traced matrix path can also be recorded with **Export journey GIF**. The checked path remains selected until the board is edited or a new object is selected. Dependency arrows stay static and do not keep an otherwise idle imported board animating. The example Terraform file takes an `ami_id` variable and the CloudFormation example takes an `ImageId` parameter if you use them outside the diagram importer.

### Saved traffic scenarios and walkthrough captions

Open **Traffic** and choose **Public HTTPS**, **SSH from office**, or **Worker egress**. The example office address is a documentation IP; replace it with your intended source. Edit the traffic fields, give the profile a name, and choose **Save / update scenario**. Choose the blank scenario entry to save a new profile. **Use scenario** applies its parameters; **Delete** removes the selected profile. Profiles are stored per diagram, travel with the project, and support undo/redo. The Reachability matrix also offers the saved profiles.

A profile can save an optional start and destination. With both set, **Use scenario** runs the resource reachability check and prepares its known allowed/denied path for Journey or recording. An Unknown result provides no checked path; use the matrix decision details to supply the missing policy information. With only a start, Journey follows its arrows. Add a **Walkthrough caption** in each resource's properties to explain that hop. The current resource label and caption appear during live journeys and in GIF/video recordings. At simultaneous forks the most recently visited resource supplies the caption.

### Video recording

Choose **Export journey video…** in the file menu or command search. Select **WebM** or **MP4**, set **2–120 seconds**, and record. Unsupported formats are marked unavailable: container/codec support depends on the browser or native WebKit runtime. Recording uses the offline MediaRecorder API; it does not call a conversion service. Capture is up to **30 fps** and **1280 × 720**, maintaining the current view's aspect ratio, with full colour and hop captions. The export includes no audio. Files are limited to **100 MB**. Press **Esc** to cancel; cancellation stops the recorder, releases the stream, and restores editing. Decision forks use their first branch during recording, as with GIF.

### Linked detail diagrams

Select a VPC, boundary, or service, expand **Detail diagram**, and choose **Create detail diagram** to create an empty board linked to that resource. Build its details using the ordinary editing/import/layout tools. **← Back** and the project name above the canvas navigate between boards. All boards share one project file, recovery snapshot, saved state, and undo history. Undo/redo opens the board containing the affected edit.

Open an existing detail with the resource's **Open detail ↗** button, its link in Layers, or by double-clicking the linked resource on the canvas. Use the Label property to rename linked resources. **Linked diagram** can attach another existing detail or unlink it; unlinked diagrams remain in that selector so they can be reused. A project supports up to 100 detail boards. Detail boards may link to other detail boards. Copies made through the clipboard omit project links; relink the pasted resource using its properties.

Imports operate on the current board. Saving or Save As always saves the whole project. PNG/SVG/GIF/video and Mermaid/PlantUML export the current board; draw.io export includes the project overview and every detail as a page, with internal page links on linked resources.

### Diagram source exports

The file menu and command search offer **Export Mermaid source** (`.mmd`), **Export PlantUML source** (`.puml`), and **Export draw.io project** (`.drawio`). These exports work offline. Mermaid and PlantUML retain nested boundaries, nodes, labeled arrows, and dependency relationships as deterministic text suitable for documentation and git diffs. Hop captions and detail IDs are included as comments. Draw.io produces uncompressed editable XML, preserving box coordinates, hierarchy, colours, and linked detail pages.

These formats describe the architecture; they do not reproduce Solar Forge's resource policies, saved scenarios, animation, artwork, or every manual edge bend. Keep the native JSON project as the editable source of truth for those features. Native projects are also formatted plain text. Exported Mermaid/PlantUML source requires a compatible renderer when embedded in other tools.

### Kubernetes resources

Search **Components** for `Kubernetes`, `k8s`, or a resource name to add **Pod**, **Deployment**, **Service**, **Ingress**, or **Namespace**. The five official resource icons are bundled offline in Kubernetes blue. They appear in the palette, Layers, canvas and self-contained SVG export. Namespace is a resizable group with an icon in its header; place resources inside it using **Inside boundary**, and move/resize/layout it using the existing group tools.

The **Examples → Kubernetes → Applications → Kubernetes · web application** template shows HTTPS → Ingress → Service → two Pod backends inside a production namespace. Deployment management connections are dependencies and are excluded from traffic journeys; the Deployment's notes explain the omitted ReplicaSet. Each traffic hop has a walkthrough caption. The two Service branches represent possible backends, rather than two requests sent for every HTTP request. Namespace is logical scope, not a network firewall; this example does not simulate Kubernetes NetworkPolicy or an ingress controller.

The artwork's Apache-2.0 license, unmodified upstream README, pinned revision and per-file hashes are in [assets/kubernetes](../assets/kubernetes/NOTICE.md).
