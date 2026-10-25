import './tour.css';

/** One stop on the features tour; `target` is the control it points at. */
export interface TourStep {
  title: string;
  body: string;
  target?: string;
}

export const featureTour: readonly TourStep[] = [
  {
    title: 'Welcome to Solar Forge',
    body: 'A quick run through what you can do. Use the arrow keys or the buttons below, and press Esc to leave at any time.',
  },
  {
    title: 'Add components',
    body: 'Open Components (or press /) and search AWS, Kubernetes, container and flowchart pieces, including Cognito, WAF and Shield. Enter drops the highlighted one on the board.',
    target: '#components',
  },
  {
    title: 'Connect them',
    body: 'Press C, then drag from one component to another. Connect them both ways and the pair is drawn as two parallel one-way arrows, so each direction of traffic stays readable.',
    target: '#tool-connect',
  },
  {
    title: 'Group into boundaries',
    body: 'Select several components and press Ctrl+G to wrap them in an account, region, VPC or subnet boundary. Drag a component into a boundary to nest it.',
    target: '#tool-group',
  },
  {
    title: 'Text and sticky notes',
    body: 'Press T for free text or N for a sticky note, then click the board. Double-click anything to edit its text.',
    target: '#tool-note',
  },
  {
    title: 'Properties and details',
    body: 'The Layers panel lists everything on the board. Select a component to rename it, set its text size (blank fits it on one line), turn on caption wrapping, and fill in architecture details. Select many components to fill in their details together.',
    target: '#toggle-layers',
  },
  {
    title: 'Watch data flow',
    body: 'Flow animates traffic along every connection. Journey walks a traveller through your architecture with captions, and Traffic checks which requests your rules allow.',
    target: '#flow',
  },
  {
    title: 'Import and check networks',
    body: 'The File menu imports Terraform, CloudFormation and Docker Compose, lays them out automatically, and builds a reachability matrix that explains which traffic is allowed.',
    target: '#menu',
  },
  {
    title: 'Themes and fonts',
    body: 'Pick a theme, from Cyberpunk to Comic Noir and Deep Space, and choose the board font: Standard, Courier New or Terminal.',
    target: '#theme',
  },
  {
    title: 'Share it',
    body: 'Export PNG, SVG, an animated GIF or video of a journey, or Mermaid, PlantUML and draw.io source. Copy image puts a picture on your clipboard.',
    target: '#quick-export',
  },
  {
    title: 'Keyboard shortcuts',
    body: 'Every shortcut is listed here, along with the rendering quality setting. That’s the tour. Have fun forging!',
    target: '#help',
  },
];

/**
 * Show the tour over the app. A spotlight follows each step's control and a
 * card explains it. Resolves when the tour closes.
 */
export function startTour(
  steps: readonly TourStep[] = featureTour,
): Promise<void> {
  document.querySelector('.tour')?.remove();
  const root = document.createElement('div');
  root.className = 'tour';
  const spotlight = document.createElement('div');
  spotlight.className = 'tour-spotlight';
  const card = document.createElement('section');
  card.className = 'tour-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'tour-title');
  const counter = document.createElement('p');
  counter.className = 'tour-count';
  const title = document.createElement('h2');
  title.id = 'tour-title';
  const body = document.createElement('p');
  body.className = 'tour-body';
  const actions = document.createElement('div');
  actions.className = 'tour-actions';
  const skip = button('Skip tour', 'tour-skip');
  const back = button('Back');
  const next = button('Next', 'tour-next');
  actions.append(skip, back, next);
  card.append(counter, title, body, actions);
  root.append(spotlight, card);
  document.body.append(root);
  const previousFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : undefined;
  let index = 0;
  let done: () => void = () => {};
  const finished = new Promise<void>((resolve) => {
    done = resolve;
  });
  const close = () => {
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', place);
    root.remove();
    previousFocus?.focus();
    done();
  };
  function place(): void {
    const step = steps[index];
    const target = step?.target
      ? document.querySelector<HTMLElement>(step.target)
      : null;
    const rect =
      target && target.offsetParent !== null
        ? target.getBoundingClientRect()
        : undefined;
    root.classList.toggle('tour-centered', !rect);
    if (!rect) {
      // Shrink the spotlight to nothing in the middle: a plain dimmed screen.
      Object.assign(spotlight.style, {
        left: '50%',
        top: '50%',
        width: '0',
        height: '0',
      });
      card.style.left = '';
      card.style.top = '';
      return;
    }
    const pad = 6;
    Object.assign(spotlight.style, {
      left: `${rect.left - pad}px`,
      top: `${rect.top - pad}px`,
      width: `${rect.width + pad * 2}px`,
      height: `${rect.height + pad * 2}px`,
    });
    // Beside the control, kept on screen: below it unless there is no room.
    const { innerWidth: width, innerHeight: height } = window;
    const box = card.getBoundingClientRect();
    const below = rect.bottom + 14 + box.height <= height - 12;
    const top = below
      ? rect.bottom + 14
      : Math.max(12, rect.top - 14 - box.height);
    const left = Math.min(
      Math.max(12, rect.left + rect.width / 2 - box.width / 2),
      width - box.width - 12,
    );
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }
  const show = (to: number) => {
    index = Math.max(0, Math.min(steps.length - 1, to));
    const step = steps[index];
    if (!step) return;
    counter.textContent = `${index + 1} / ${steps.length}`;
    title.textContent = step.title;
    body.textContent = step.body;
    back.disabled = index === 0;
    const last = index === steps.length - 1;
    next.textContent = last ? 'Done' : 'Next';
    skip.hidden = last;
    place();
    next.focus();
  };
  function onKey(event: KeyboardEvent): void {
    // The tour owns the keyboard while open: no tool shortcuts underneath.
    event.stopPropagation();
    if (event.key === 'Escape') close();
    else if (event.key === 'ArrowRight') show(index + 1);
    else if (event.key === 'ArrowLeft') show(index - 1);
    else if (event.key === 'Tab') {
      // Keep focus inside the card.
      const buttons = [skip, back, next].filter(
        (b) => !b.hidden && !b.disabled,
      );
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const step = event.shiftKey ? -1 : 1;
      buttons[(at + step + buttons.length) % buttons.length]?.focus();
      event.preventDefault();
    } else if (event.key !== 'Enter' && event.key !== ' ')
      event.preventDefault();
  }
  next.onclick = () => (index === steps.length - 1 ? close() : show(index + 1));
  back.onclick = () => show(index - 1);
  skip.onclick = close;
  root.onclick = (event) => {
    if (event.target === root) close();
  };
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', place);
  show(0);
  return finished;
}

function button(text: string, className?: string): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = text;
  if (className) element.className = className;
  return element;
}
