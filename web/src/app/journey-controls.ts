import { branchName, journeyBranches, journeyStarts } from '../domain/journey';
import {
  defaultTraffic,
  evaluateTraffic,
  parseTraffic,
} from '../domain/network';
import { checkReachability } from '../domain/reachability';
import { defaultScenarios } from '../domain/scenarios';
import { element, field } from '../ui/dom';
import { reachabilityPanel } from '../ui/reachability';
import type { App } from './context';

export interface JourneyControls {
  /** Play a journey from the selection, or stop the one that is playing. */
  toggleJourney(): void;
}

/**
 * Journey playback: the Journey button, traffic and saved scenarios, rule and
 * reachability checks at each hop, captions, and the decision chooser.
 */
export function installJourneyControls(app: App): JourneyControls {
  const { state, scene, notify, commit } = app;
  const reachability = reachabilityPanel({
    document: () => state.current,
    play: (result) => {
      state.checkedJourney = {
        path: result.path,
        allowed: result.status === 'allowed',
      };
      scene.playJourney([result.path[0] ?? ''], {
        path: result.path,
        allowed: result.status === 'allowed',
      });
      element('journey').setAttribute('aria-pressed', 'true');
      notify(
        `${result.status.toUpperCase()} · ${result.reason} · P or Esc to stop`,
      );
    },
  });
  element('reachability').onclick = () => {
    element('file-menu').hidden = true;
    reachability.open();
  };
  function scenarioOptions() {
    return state.current.scenarios ?? defaultScenarios;
  }
  function refreshScenarioChoices(): void {
    const select = element('traffic-scenario') as HTMLSelectElement;
    const previous = select.value;
    select.replaceChildren(
      new Option('Choose a scenario…', ''),
      ...scenarioOptions().map(
        (scenario) => new Option(scenario.name, scenario.id),
      ),
    );
    select.value = previous;
    for (const id of ['scenario-source', 'scenario-target']) {
      const endpoint = element(id) as HTMLSelectElement;
      const value = endpoint.value;
      endpoint.replaceChildren(
        new Option('Not set', ''),
        ...state.current.nodes
          .filter((n) => n.kind === 'service')
          .map((n) => new Option(n.label, n.id)),
      );
      endpoint.value = value;
    }
  }
  function readTrafficFields() {
    return parseTraffic({
      protocol: field('traffic-protocol').value,
      port: Number(field('traffic-port').value),
      sourceIp: field('traffic-source').value.trim(),
      direction: field('traffic-direction').value,
    });
  }
  field('traffic-scenario').onchange = () => {
    const scenario = scenarioOptions().find(
      (item) => item.id === field('traffic-scenario').value,
    );
    if (!scenario) return;
    field('scenario-name').value = scenario.name;
    for (const [key, endpoint] of [
      ['sourceId', 'scenario-source'],
      ['targetId', 'scenario-target'],
    ] as const) {
      const select = element(endpoint) as HTMLSelectElement;
      const id = scenario[key];
      if (id && ![...select.options].some((option) => option.value === id))
        select.add(new Option(`Missing resource: ${id}`, id));
      select.value = id ?? '';
    }
    field('traffic-protocol').value = scenario.traffic.protocol;
    field('traffic-port').value = String(scenario.traffic.port);
    field('traffic-source').value = scenario.traffic.sourceIp;
    field('traffic-direction').value = scenario.traffic.direction;
  };
  element('scenario-save').onclick = () => {
    try {
      const name = field('scenario-name').value.trim();
      if (!name) throw Error('Give the scenario a name');
      const existing = field('traffic-scenario').value;
      const id = existing || crypto.randomUUID();
      const scenarios = scenarioOptions().filter((item) => item.id !== id);
      if (scenarios.length >= 100)
        throw Error('A diagram supports up to 100 scenarios');
      scenarios.push({
        id,
        name,
        traffic: readTrafficFields(),
        ...(field('scenario-source').value
          ? { sourceId: field('scenario-source').value }
          : {}),
        ...(field('scenario-target').value
          ? { targetId: field('scenario-target').value }
          : {}),
      });
      commit({ type: 'scenarios', scenarios });
      refreshScenarioChoices();
      field('traffic-scenario').value = id;
      notify(`Saved scenario ${name}`);
    } catch (error) {
      notify(String(error));
    }
  };
  element('scenario-delete').onclick = () => {
    const id = field('traffic-scenario').value;
    if (!id) return;
    commit({
      type: 'scenarios',
      scenarios: scenarioOptions().filter((item) => item.id !== id),
    });
    refreshScenarioChoices();
  };
  element('scenario-use').onclick = () => {
    try {
      const traffic = readTrafficFields();
      const source = field('scenario-source').value,
        target = field('scenario-target').value;
      state.checkedJourney = undefined;
      if (source && !state.current.nodes.some((n) => n.id === source))
        throw Error('Scenario start is missing; choose another resource');
      if (target && !state.current.nodes.some((n) => n.id === target))
        throw Error('Scenario destination is missing; choose another resource');
      commit({ type: 'traffic', from: state.current.traffic, to: traffic });
      if (source && target) {
        const result = checkReachability(
          state.current,
          source,
          target,
          traffic,
        );
        notify(`${result.status}: ${result.reason}`);
        if (result.status !== 'unknown')
          state.checkedJourney = {
            path: result.path,
            allowed: result.status === 'allowed',
          };
      } else {
        if (source) scene.select(source);
        notify('Traffic scenario applied');
      }
      scene.stopJourney();
      element('traffic-panel').hidden = true;
    } catch (error) {
      notify(String(error));
    }
  };
  function toggleJourney(): void {
    if (scene.journeyPlaying) {
      scene.stopJourney();
      return;
    }
    const starts = state.checkedJourney
      ? state.checkedJourney.path.slice(0, 1)
      : journeyStarts(state.current, state.selected);
    if (!starts.length) {
      notify(
        'No flow arrows. Use Reachability matrix for imported resources, or connect components.',
      );
      return;
    }
    scene.playJourney(starts, state.checkedJourney);
    element('journey').setAttribute('aria-pressed', 'true');
    const names = starts
      .map((id) => state.current.nodes.find((n) => n.id === id)?.label)
      .join(', ');
    notify(`Journey from ${names} · P or Esc to stop`);
  }
  element('journey').onclick = toggleJourney;
  element('traffic-settings').onclick = () => {
    const panel = element('traffic-panel');
    panel.hidden = !panel.hidden;
    refreshScenarioChoices();
    const traffic = state.current.traffic ?? defaultTraffic;
    field('traffic-protocol').value = traffic.protocol;
    field('traffic-port').value = String(traffic.port);
    field('traffic-source').value = traffic.sourceIp;
    field('traffic-direction').value = traffic.direction;
  };
  element('traffic-apply').onclick = () => {
    try {
      const traffic = parseTraffic({
        protocol: field('traffic-protocol').value,
        port: Number(field('traffic-port').value),
        sourceIp: field('traffic-source').value.trim(),
        direction: field('traffic-direction').value,
      });
      commit({ type: 'traffic', from: state.current.traffic, to: traffic });
      element('traffic-panel').hidden = true;
    } catch (error) {
      notify(String(error));
    }
  };
  scene.onJourneyPermit = (id) => {
    const edge = state.current.edges.find((e) => e.id === id);
    const result = evaluateTraffic(
      edge?.networkRule,
      state.current.traffic ?? defaultTraffic,
    );
    if (
      edge &&
      (state.current.nodes.find((n) => n.id === edge.source)?.network ||
        state.current.nodes.find((n) => n.id === edge.target)?.network)
    ) {
      const reach = checkReachability(
        state.current,
        edge.source,
        edge.target,
        state.current.traffic ?? defaultTraffic,
      );
      if (reach.status !== 'allowed') {
        notify(`${reach.status.toUpperCase()} · ${reach.reason}`);
        return false;
      }
    }
    if (!result.allowed)
      notify(`Blocked · ${edge?.label || id} · ${result.reason}`);
    return result.allowed;
  };
  /** Handoffs between owners on the journey playing now. */
  let handoffs = 0;
  /** A step's owner, or the owner of the nearest group around it. */
  const ownerOf = (id: string): string | undefined => {
    const nodes = state.current.nodes;
    const seen = new Set<string>();
    for (
      let node = nodes.find((n) => n.id === id);
      node && !seen.has(node.id);
      node = nodes.find((n) => n.id === node?.parentId)
    ) {
      seen.add(node.id);
      if (node.owner) return node.owner;
    }
    return undefined;
  };
  scene.onJourneyHop = (id) => {
    const edge = state.current.edges.find((e) => e.id === id);
    if (!edge) return;
    const name = (nodeId: string) =>
      state.current.nodes.find((n) => n.id === nodeId)?.label ?? '';
    const from = ownerOf(edge.source);
    const to = ownerOf(edge.target);
    const handoff = from !== undefined && to !== undefined && from !== to;
    if (handoff) handoffs++;
    notify(
      `${edge.networkRule ? 'Allowed · ' : ''}${name(edge.source)} → ${name(edge.target)}${edge.label ? ` · ${edge.label}` : ''}${handoff ? ` · Handoff ${from} → ${to}` : ''}`,
    );
  };
  scene.onJourneyCaption = (caption) => {
    element('journey-caption').textContent = caption;
    element('journey-caption').hidden = !caption;
  };
  scene.onJourneyEnd = () => {
    element('journey').setAttribute('aria-pressed', 'false');
    if (handoffs)
      notify(
        `Journey finished · ${handoffs} handoff${handoffs === 1 ? '' : 's'} between owners`,
      );
    handoffs = 0;
  };
  scene.onJourneyBranches = (id) => journeyBranches(state.current, id);
  let chooser: { close: (edge?: string) => void } | undefined;
  scene.onJourneyChoose = (nodeId, edges) =>
    new Promise((resolve) => {
      if (state.recording) {
        resolve(edges[0]);
        return;
      }
      const node = state.current.nodes.find((n) => n.id === nodeId);
      const rect = scene.nodeScreenRect(nodeId);
      const panel = document.createElement('section');
      panel.className = 'popover decision-chooser';
      panel.setAttribute('aria-label', 'Choose a branch');
      const caption = document.createElement('p');
      caption.className = 'popover-caption';
      caption.textContent = 'DECISION';
      const title = document.createElement('h2');
      title.textContent = node?.label || 'Which way?';
      panel.append(caption, title);
      const close = (edge?: string) => {
        panel.remove();
        chooser = undefined;
        resolve(edge);
      };
      edges.forEach((edge, index) => {
        const button = document.createElement('button');
        const key = document.createElement('kbd');
        key.textContent = String(index + 1);
        const name = document.createElement('span');
        name.textContent = branchName(state.current, edge);
        button.append(key, name);
        button.onclick = () => close(edge);
        panel.append(button);
      });
      document.body.append(panel);
      const width = panel.offsetWidth;
      const height = panel.offsetHeight;
      const left = rect
        ? rect.left + rect.width + 16
        : innerWidth / 2 - width / 2;
      const top = rect
        ? rect.top + rect.height / 2 - height / 2
        : innerHeight / 3;
      panel.style.left = `${Math.max(12, Math.min(left, innerWidth - width - 12))}px`;
      panel.style.top = `${Math.max(64, Math.min(top, innerHeight - height - 80))}px`;
      chooser = { close };
      notify(
        `Decision at ${node?.label ?? 'a fork'} · choose a branch (1–${edges.length})`,
      );
    });
  scene.onJourneyCancelChoice = () => chooser?.close();
  // Number keys answer an open decision before any other shortcut.
  window.addEventListener(
    'keydown',
    (event) => {
      if (!chooser || event.ctrlKey || event.metaKey || event.altKey) return;
      const index = Number(event.key) - 1;
      const buttons = document.querySelectorAll<HTMLButtonElement>(
        '.decision-chooser button',
      );
      if (Number.isInteger(index) && buttons[index]) {
        event.preventDefault();
        event.stopImmediatePropagation();
        buttons[index].click();
      }
    },
    { capture: true },
  );

  return { toggleJourney };
}
