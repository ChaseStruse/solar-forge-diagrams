# Documents and recovery

Solar Forge writes version 1 `.sforge.json` documents. The graph is authoritative; camera state, selection and undo stacks are not required to reopen a document. Version 1 remains backward compatible with the first prototype. Unknown future versions fail validation before replacing the current board. No earlier public version exists to migrate; future schema changes must add explicit migrations and fixtures before shipping. Unsupported or malformed files are never rewritten on failed Open.

Save chooses a destination once. Subsequent saves use an opaque native session handle; Save As chooses another destination. Handles expire when the application exits. Native commands cannot write arbitrary frontend-supplied paths. Writes use a unique temporary file in the destination directory, sync its contents, rename atomically, and sync the directory. A failed replacement preserves the previous target. Directory-sync failure after rename can mean the replacement is present but durability is uncertain; the error remains visible and the editor stays unsaved.

Unsaved edits schedule an atomic recovery snapshot in the platform application-data directory (`$XDG_DATA_HOME/com.solarforge.diagrams`, normally `~/.local/share/com.solarforge.diagrams`). Recovery is debounced by 750 ms, with a maximum five-second wait during continuous editing. Losing power during that interval may lose the most recent edits. Failed recovery writes are visible and retry on later edits/flush. Recovery writes are ordered so an old snapshot cannot overtake a later save or discard. Recovery does not overwrite the chosen document.

At startup, recover the unsaved board, explicitly discard its recovery, or close the application and leave it for later. Recovered boards open as unsaved documents and ask for a destination, protecting the original file. Closing or replacing a dirty board offers Save, Discard changes, and Cancel. Failed/cancelled saves keep the board open. One process holds an application-data lock to prevent concurrent instances overwriting the same recovery snapshot. Deleting application data removes recovery and settings, not user-selected documents.

Undo retains at most 100 actions and an estimated 8 MB of affected serialized records. This is an estimate of retained payload, not a JavaScript heap guarantee. A drag is one transaction. A new edit invalidates redo. Undoing back to the saved revision clears the dirty indicator; later edits remain dirty even when an earlier asynchronous save completes.

### Optional networking fields

Version 1 documents may include `traffic: { protocol, port, sourceIp, direction }` at the document root. Protocol is `tcp`, `udp`, or `icmp`; direction is `ingress` or `egress`; port is an integer from 1–65535; sourceIp is an IPv4 address. If absent, playback uses TCP/443 ingress from `203.0.113.10`.

Edges may include `networkRule: { action, protocol, direction, port?, sourceCidr? }`. Action is `allow` or `deny`. Protocol and direction also accept `any`. An allow rule requires all specified constraints to match; a deny rule blocks the connection unconditionally. Missing rules allow traversal. Source CIDRs use IPv4 with prefix length 0–32. Invalid network fields are rejected on import. The document version remains 1 because these fields are optional; older application versions discard them when loading/saving.


### Resource networking and infrastructure relationships

Nodes optionally store `network` and `policy`. `network` includes `model` (`aws`, `compose`, `generic`), IPv4 `ip`/`publicIp`, boundary `cidr`, `exposure`, `securityGroupIds`, subnet `networkAclId`/`routeTableId`, Compose `networkIds`, and `incomplete` messages. A `policy` is a `security-group` or `network-acl` with rules, or a `route-table` with routes. Rules contain action, direction, protocol, optional inclusive port range, CIDR or security-group peer; ACL rules require unique priorities per direction. Routes contain a destination CIDR and a target node ID, `local`, or `blackhole`.

References are validated on load. Copy/paste remaps attached policies and peers; missing attachments are marked incomplete, removed peer rules cannot broaden access, and missing route targets become blackholes. Deletion and ungrouping preserve valid remaining references and undo restores them. An edge's optional `relationship` is `dependency` or `network`; dependency edges are excluded from journey traversal. These optional fields retain document version 1; older releases discard them when re-saving, so use this version to retain policy information.
