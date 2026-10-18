import {
  type DiagramDocument,
  type DiagramNode,
  parseDocument,
  serializeDocument,
} from '../domain/document';
import {
  type FirewallRule,
  parseResourceNetwork,
  parseResourcePolicy,
  type ResourcePolicy,
} from '../domain/policies';

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (text) n.textContent = text;
  return n;
}
function input(value = '', type = 'text'): HTMLInputElement {
  const n = element('input');
  n.type = type;
  n.value = value;
  return n;
}
function portRange(
  from: HTMLInputElement,
  to: HTMLInputElement,
): Record<string, number> {
  if (from.disabled || (!from.value && !to.value)) return {};
  if (!from.value || !to.value)
    throw Error('Enter both ends of the port range, or leave both blank');
  return { fromPort: Number(from.value), toPort: Number(to.value) };
}
function select(options: [string, string][], value = ''): HTMLSelectElement {
  const n = element('select');
  for (const [id, label] of options) {
    const o = element('option', label);
    o.value = id;
    n.append(o);
  }
  n.value = value;
  return n;
}
function field(parent: HTMLElement, label: string, control: HTMLElement): void {
  const wrap = element('label', label);
  wrap.append(control);
  parent.append(wrap);
}
function multi(
  doc: DiagramDocument,
  filter: (n: DiagramNode) => boolean,
  selected: string[],
): HTMLSelectElement {
  const n = select(doc.nodes.filter(filter).map((n) => [n.id, n.label]));
  n.multiple = true;
  n.size = 4;
  for (const option of n.options)
    option.selected = selected.includes(option.value);
  return n;
}

/** Structured resource attachments and rule editors; one Apply is one undo step. */
export function renderNetworkProperties(
  container: HTMLElement,
  node: DiagramNode | undefined,
  doc: DiagramDocument,
  apply: (value: DiagramNode) => void,
  notify: (message: string) => void,
): void {
  container.replaceChildren();
  if (!node || node.kind === 'text' || node.kind === 'note') return;
  const details = element('details');
  details.open = !!(node.network || node.policy);
  details.append(element('summary', 'Resource networking'));
  container.append(details);
  const enabled = input('', 'checkbox');
  enabled.checked = !!node.network;
  field(details, 'Enable network model', enabled);
  const model = select(
    [
      ['aws', 'AWS IPv4'],
      ['generic', 'Generic IPv4'],
      ['compose', 'Compose network'],
    ],
    node.network?.model ?? 'aws',
  );
  field(details, 'Network model', model);
  const ip = input(node.network?.ip ?? ''),
    publicIp = input(node.network?.publicIp ?? ''),
    cidr = input(node.network?.cidr ?? '');
  if (node.kind === 'service' && !node.policy) {
    field(details, 'Private / endpoint IPv4', ip);
    field(details, 'Public IPv4 (if known)', publicIp);
  }
  if (node.kind === 'group') field(details, 'Boundary CIDR', cidr);
  const exposure = select(
    [
      ['unknown', 'Unknown'],
      ['private', 'Private'],
      ['public', 'Public address assigned'],
    ],
    node.network?.exposure ?? 'unknown',
  );
  if (node.kind === 'service' && !node.policy)
    field(details, 'Public address assignment', exposure);
  const sg = multi(
    doc,
    (n) => n.policy?.kind === 'security-group',
    node.network?.securityGroupIds ?? [],
  );
  if (node.kind === 'service' && !node.policy)
    field(details, 'Attached security groups', sg);
  const choices = (kind: ResourcePolicy['kind']) =>
    [
      ['', 'Not assigned'],
      ...doc.nodes
        .filter((n) => n.policy?.kind === kind)
        .map((n) => [n.id, n.label]),
    ] as [string, string][];
  const routes = select(
      choices('route-table'),
      node.network?.routeTableId ?? '',
    ),
    acl = select(choices('network-acl'), node.network?.networkAclId ?? '');
  if (node.boundary === 'subnet') {
    field(details, 'Subnet route table', routes);
    field(details, 'Subnet network ACL', acl);
  }
  const networks = multi(
    doc,
    (n) => n.kind === 'group' && n.network?.model === 'compose',
    node.network?.networkIds ?? [],
  );
  if (node.network?.model === 'compose')
    field(details, 'Compose network attachments', networks);
  const policyKind = select(
    [
      ['', 'No resource policy'],
      ['security-group', 'Security group'],
      ['network-acl', 'Network ACL'],
      ['route-table', 'Route table'],
    ],
    node.policy?.kind ?? '',
  );
  field(details, 'Policy on this resource', policyKind);
  const rows = element('div');
  rows.className = 'network-rule-rows';
  details.append(rows);
  const add = element('button', 'Add rule / route');
  add.type = 'button';
  details.append(add);
  const readers: (() => unknown)[] = [];
  function addRow(
    raw?: FirewallRule | { destination: string; target: string },
  ): void {
    const row = element('div');
    row.className = 'network-rule-row';
    rows.append(row);
    const remove = element('button', 'Remove');
    remove.type = 'button';
    if (policyKind.value === 'route-table') {
      const route =
        raw && 'destination' in raw
          ? raw
          : { destination: '0.0.0.0/0', target: 'local' };
      const destination = input(route.destination),
        target = select(
          [
            ['local', 'Local VPC'],
            ['blackhole', 'Blackhole'],
            ...doc.nodes
              .filter((n) => n.kind === 'service' && n.id !== node?.id)
              .map((n) => [n.id, n.label] as [string, string]),
          ],
          route.target,
        );
      field(row, 'Destination CIDR', destination);
      field(row, 'Next hop', target);
      readers.push(() =>
        row.isConnected
          ? { destination: destination.value.trim(), target: target.value }
          : undefined,
      );
    } else {
      const rule: FirewallRule =
        raw && 'protocol' in raw
          ? raw
          : {
              action: 'allow',
              direction: 'ingress',
              protocol: 'tcp',
              fromPort: 443,
              toPort: 443,
              cidr: '0.0.0.0/0',
              priority: rows.children.length * 100,
            };
      const direction = select(
          [
            ['ingress', 'Ingress'],
            ['egress', 'Egress'],
          ],
          rule.direction,
        ),
        protocol = select(
          [
            ['any', 'Any IP protocol'],
            ['tcp', 'TCP'],
            ['udp', 'UDP'],
            ['icmp', 'ICMP (all types)'],
          ],
          rule.protocol,
        );
      const from = input(String(rule.fromPort ?? ''), 'number'),
        to = input(String(rule.toPort ?? ''), 'number'),
        peer = input(rule.cidr ?? '');
      from.min = to.min = '0';
      from.max = to.max = '65535';
      const peerGroup = select(
        [
          ['', 'Use CIDR / any peer'],
          ...doc.nodes
            .filter(
              (n) => n.policy?.kind === 'security-group' || n.id === node?.id,
            )
            .map((n) => [n.id, n.label] as [string, string]),
        ],
        rule.peerGroupId ?? '',
      );
      const action = select(
          [
            ['allow', 'Allow'],
            ['deny', 'Deny'],
          ],
          rule.action,
        ),
        priority = input(
          String(rule.priority ?? rows.children.length * 100),
          'number',
        );
      priority.min = '1';
      priority.max = '32766';
      field(row, 'Direction', direction);
      field(row, 'Protocol', protocol);
      field(row, 'From port (blank = all)', from);
      field(row, 'To port', to);
      field(row, 'Peer IPv4 CIDR', peer);
      if (policyKind.value === 'security-group')
        field(row, 'Or peer security group', peerGroup);
      if (policyKind.value === 'network-acl') {
        field(row, 'Action', action);
        field(row, 'Rule priority', priority);
      }
      const sync = () => {
        from.disabled = to.disabled = ['any', 'icmp'].includes(protocol.value);
        peer.disabled =
          policyKind.value === 'security-group' && !!peerGroup.value;
      };
      protocol.onchange = sync;
      peerGroup.onchange = sync;
      sync();
      readers.push(() =>
        row.isConnected
          ? {
              direction: direction.value,
              protocol: protocol.value,
              action:
                policyKind.value === 'security-group' ? 'allow' : action.value,
              ...portRange(from, to),
              ...(policyKind.value === 'security-group' && peerGroup.value
                ? { peerGroupId: peerGroup.value }
                : peer.value.trim()
                  ? { cidr: peer.value.trim() }
                  : {}),
              ...(policyKind.value === 'network-acl'
                ? { priority: Number(priority.value) }
                : {}),
            }
          : undefined,
      );
    }
    remove.onclick = () => row.remove();
    row.append(remove);
  }
  const renderRows = () => {
    rows.replaceChildren();
    readers.length = 0;
    add.disabled = !policyKind.value;
    const policy = node?.policy;
    if (policy?.kind === policyKind.value) {
      if (policy.kind === 'route-table')
        for (const r of policy.routes) addRow(r);
      else for (const r of policy.rules) addRow(r);
    }
  };
  policyKind.onchange = renderRows;
  add.onclick = () => addRow();
  renderRows();
  const unresolved = [
    ...(node.network?.incomplete ?? []),
    ...(node.policy?.incomplete ?? []),
  ];
  const reviewed = input('', 'checkbox');
  if (unresolved.length) {
    details.append(
      element('p', `Unresolved import values: ${unresolved.join('; ')}`),
    );
    field(details, 'I have supplied the missing settings above', reviewed);
  }
  details.append(
    element(
      'p',
      'Security groups allow matching rules from any attached group; no match denies. ACLs use the first matching priority, then implicit deny, including return traffic. No assigned ACL is modeled as default allow.',
    ),
  );
  const save = element('button', 'Apply resource networking');
  save.type = 'button';
  details.append(save);
  save.onclick = () => {
    try {
      const value = structuredClone(node);
      if (enabled.checked)
        value.network = parseResourceNetwork({
          model: model.value,
          ...(ip.value.trim() ? { ip: ip.value.trim() } : {}),
          ...(publicIp.value.trim() ? { publicIp: publicIp.value.trim() } : {}),
          ...(node.kind === 'group' && cidr.value.trim()
            ? { cidr: cidr.value.trim() }
            : {}),
          exposure: exposure.value,
          securityGroupIds: Array.from(sg.selectedOptions, (o) => o.value),
          ...(node.boundary === 'subnet' && routes.value
            ? { routeTableId: routes.value }
            : {}),
          ...(node.boundary === 'subnet' && acl.value
            ? { networkAclId: acl.value }
            : {}),
          ...(node.network?.model === 'compose'
            ? {
                networkIds: Array.from(
                  networks.selectedOptions,
                  (o) => o.value,
                ),
              }
            : {}),
          ...(!reviewed.checked && node.network?.incomplete
            ? { incomplete: node.network.incomplete }
            : {}),
        });
      else delete value.network;
      if (policyKind.value)
        value.policy = parseResourcePolicy({
          kind: policyKind.value,
          [policyKind.value === 'route-table' ? 'routes' : 'rules']: readers
            .map((read) => read())
            .filter(Boolean),
          ...(!reviewed.checked &&
          node.policy?.incomplete &&
          node.policy.kind === policyKind.value
            ? { incomplete: node.policy.incomplete }
            : {}),
        });
      else delete value.policy;
      parseDocument(
        serializeDocument({
          ...doc,
          nodes: doc.nodes.map((n) => (n.id === node.id ? value : n)),
        }),
      );
      apply(value);
    } catch (error) {
      notify(String(error));
    }
  };
}
