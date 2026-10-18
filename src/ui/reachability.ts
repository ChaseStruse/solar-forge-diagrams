import type {
  DiagramDocument,
  DiagramNode,
  JourneyTraffic,
} from '../domain/document';
import { defaultTraffic, parseTraffic } from '../domain/network';
import {
  checkReachability,
  nodeIndex,
  type ReachabilityResult,
} from '../domain/reachability';
import { defaultScenarios } from '../domain/scenarios';

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const n = document.createElement(tag);
  if (text) n.textContent = text;
  return n;
};
const options = (select: HTMLSelectElement, nodes: DiagramNode[]) => {
  select.replaceChildren(
    ...nodes.map((n) => {
      const o = el('option', n.label);
      o.value = n.id;
      return o;
    }),
  );
};
export function reachabilityPanel(host: {
  document: () => DiagramDocument;
  play: (result: ReachabilityResult) => void;
}): { open: () => void; close: () => void } {
  const panel = el('section');
  panel.className = 'workspace-dialog reachability-dialog';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Reachability matrix');
  panel.innerHTML = `<div class="dialog-heading"><h2>Can A reach B?</h2><button data-close aria-label="Close reachability">×</button></div><p>Static IPv4 reachability from the modeled routes, security groups and subnet ACLs. Security-group replies are stateful; ACL replies use the source port. Missing addresses and unsupported constructs produce Unknown. Unassigned ACLs assume default allow. External routing is assumed available after a valid internet-gateway route.</p><label>Traffic scenario<select data-scenario><option value="">Custom traffic</option></select></label><div class="reachability-controls"><label>Protocol<select data-protocol><option value="tcp">TCP</option><option value="udp">UDP</option><option value="icmp">ICMP</option></select></label><label>Destination port<input data-port type="number" min="1" max="65535" value="443"></label><label>Source port for ACL replies<input data-source-port type="number" min="1" max="65535" value="49152"></label><label>Source IPv4 fallback for external actors<input data-ip value="203.0.113.10"></label><label>From<select data-source></select></label><label>To<select data-target></select></label></div><div class="dialog-actions"><button data-check>Check flow</button><button data-build>Refresh matrix</button></div><div data-result role="status"></div><button data-play disabled>Trace journey</button><details><summary>Decision details</summary><ol data-checks></ol></details><hr><label>Filter resources<input data-filter placeholder="Name or resource ID"></label><div class="matrix-pages"><button data-rows-prev>Previous sources</button><button data-rows-next>Next sources</button><button data-cols-prev>Previous destinations</button><button data-cols-next>Next destinations</button></div><p data-page></p><div class="matrix-scroll" data-matrix></div>`;
  document.body.append(panel);
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  const app = document.getElementById('app');
  const find = <T extends HTMLElement>(q: string) => {
    const n = panel.querySelector<T>(q);
    if (!n) throw Error('Missing reachability control');
    return n;
  };
  const scenarioSelect = find<HTMLSelectElement>('[data-scenario]');
  scenarioSelect.onchange = () => {
    const scenario = (host.document().scenarios ?? defaultScenarios).find(
      (item) => item.id === scenarioSelect.value,
    );
    if (!scenario) return;
    protocol.value = scenario.traffic.protocol;
    port.value = String(scenario.traffic.port);
    ip.value = scenario.traffic.sourceIp;
    if (scenario.sourceId) source.value = scenario.sourceId;
    if (scenario.targetId) target.value = scenario.targetId;
    build();
    check();
  };
  const source = find<HTMLSelectElement>('[data-source]'),
    target = find<HTMLSelectElement>('[data-target]'),
    protocol = find<HTMLSelectElement>('[data-protocol]'),
    port = find<HTMLInputElement>('[data-port]'),
    ip = find<HTMLInputElement>('[data-ip]'),
    replyPort = find<HTMLInputElement>('[data-source-port]'),
    filter = find<HTMLInputElement>('[data-filter]'),
    matrix = find('[data-matrix]'),
    result = find('[data-result]'),
    checks = find('[data-checks]'),
    play = find<HTMLButtonElement>('[data-play]');
  let selected: ReachabilityResult | undefined,
    rowPage = 0,
    colPage = 0;
  const candidates = () =>
    host
      .document()
      .nodes.filter(
        (n) =>
          n.kind === 'service' &&
          !n.policy &&
          ![
            'component.internet-gateway',
            'component.nat-gateway',
            'component.route-table',
            'component.firewall',
            'component.network-acl',
          ].includes(n.serviceId ?? ''),
      );
  const parameters = (): { traffic: JourneyTraffic; sourcePort: number } => {
    const sourcePort = Number(replyPort.value);
    if (!Number.isInteger(sourcePort) || sourcePort < 1 || sourcePort > 65535)
      throw Error('Source port must be 1–65535');
    return {
      traffic: parseTraffic({
        protocol: protocol.value,
        port: Number(port.value),
        sourceIp: ip.value.trim(),
        direction: 'ingress',
      }),
      sourcePort,
    };
  };
  const show = (value: ReachabilityResult) => {
    selected = value;
    result.textContent = `${value.status.toUpperCase()} · ${value.reason}`;
    result.className = `reachability-result ${value.status}`;
    const doc = host.document();
    checks.replaceChildren(
      el(
        'li',
        `Path: ${value.path.map((id) => doc.nodes.find((n) => n.id === id)?.label ?? id).join(' → ')}`,
      ),
      ...value.checks.map((text) => el('li', text)),
    );
    play.disabled =
      value.status === 'unknown' ||
      value.path.length < 2 ||
      value.path[0] === value.path[value.path.length - 1];
  };
  const showError = (error: unknown) => {
    result.textContent = String(error);
    selected = undefined;
    play.disabled = true;
  };
  const check = () => {
    try {
      const p = parameters();
      show(
        checkReachability(
          host.document(),
          source.value,
          target.value,
          p.traffic,
          p.sourcePort,
        ),
      );
    } catch (e) {
      showError(e);
    }
  };
  const build = () => {
    try {
      const p = parameters(),
        all = candidates().filter((n) =>
          `${n.label} ${n.id}`
            .toLowerCase()
            .includes(filter.value.toLowerCase()),
        );
      const size = 12,
        pages = Math.max(1, Math.ceil(all.length / size));
      rowPage = Math.min(rowPage, pages - 1);
      colPage = Math.min(colPage, pages - 1);
      const doc = host.document(),
        index = nodeIndex(doc);
      const rows = all.slice(rowPage * size, (rowPage + 1) * size),
        cols = all.slice(colPage * size, (colPage + 1) * size),
        table = el('table'),
        head = el('tr');
      head.append(el('th', 'Source → destination'));
      for (const n of cols) head.append(el('th', n.label));
      const thead = el('thead');
      thead.append(head);
      table.append(thead);
      const tbody = el('tbody');
      for (const a of rows) {
        const tr = el('tr');
        const th = el('th', a.label);
        th.scope = 'row';
        tr.append(th);
        for (const b of cols) {
          const td = el('td'),
            verdict = checkReachability(
              doc,
              a.id,
              b.id,
              p.traffic,
              p.sourcePort,
              index,
            ),
            button = el(
              'button',
              verdict.status === 'allowed'
                ? 'Allowed'
                : verdict.status === 'denied'
                  ? 'Denied'
                  : 'Unknown',
            );
          button.className = verdict.status;
          button.title = verdict.reason;
          button.setAttribute(
            'aria-label',
            `${a.label} to ${b.label}: ${verdict.status}`,
          );
          button.onclick = () => {
            source.value = a.id;
            target.value = b.id;
            show(verdict);
          };
          td.append(button);
          tr.append(td);
        }
        tbody.append(tr);
      }
      table.append(tbody);
      matrix.replaceChildren(table);
      find('[data-page]').textContent =
        `${all.length} resources · source page ${rowPage + 1}/${pages} · destination page ${colPage + 1}/${pages}. Rows and columns page independently.`;
      find<HTMLButtonElement>('[data-rows-prev]').disabled = rowPage === 0;
      find<HTMLButtonElement>('[data-cols-prev]').disabled = colPage === 0;
      find<HTMLButtonElement>('[data-rows-next]').disabled =
        rowPage + 1 === pages;
      find<HTMLButtonElement>('[data-cols-next]').disabled =
        colPage + 1 === pages;
    } catch (error) {
      showError(error);
    }
  };
  find('[data-check]').onclick = check;
  find('[data-build]').onclick = build;
  for (const [selector, action] of [
    ['[data-rows-prev]', () => rowPage--],
    ['[data-rows-next]', () => rowPage++],
    ['[data-cols-prev]', () => colPage--],
    ['[data-cols-next]', () => colPage++],
  ] as const)
    find(selector).onclick = () => {
      action();
      build();
    };
  filter.oninput = () => {
    rowPage = colPage = 0;
    build();
  };
  for (const control of [protocol, port, replyPort, ip, source, target])
    control.onchange = () => {
      selected = undefined;
      play.disabled = true;
      result.textContent =
        'Parameters changed. Refresh the matrix or check a flow.';
      matrix.replaceChildren();
    };
  play.onclick = () => {
    if (selected) {
      host.play(selected);
      panel.hidden = true;
      if (app) app.inert = false;
    }
  };
  const close = () => {
    panel.hidden = true;
    if (app) app.inert = false;
  };
  find('[data-close]').onclick = close;
  panel.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  });
  return {
    close,
    open: () => {
      const doc = host.document(),
        traffic = doc.traffic ?? defaultTraffic;
      scenarioSelect.replaceChildren(
        new Option('Custom traffic', ''),
        ...(doc.scenarios ?? defaultScenarios).map(
          (item) => new Option(item.name, item.id),
        ),
      );
      protocol.value = traffic.protocol;
      port.value = String(traffic.port);
      ip.value = traffic.sourceIp;
      options(source, candidates());
      options(target, candidates());
      target.selectedIndex = Math.min(1, target.options.length - 1);
      rowPage = colPage = 0;
      panel.hidden = false;
      if (app) app.inert = true;
      build();
    },
  };
}
