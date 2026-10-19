import { exampleCategories, findExamples } from '../catalog/example-library';
import { type Template, templates } from '../catalog/templates';

/** Native modal focus containment and Escape, with searchable category navigation. */
export function chooseExample(): Promise<Template | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'decision-dialog example-browser';
    dialog.setAttribute('aria-labelledby', 'examples-title');
    dialog.innerHTML = `<div class="example-heading"><div><h2 id="examples-title">Explore examples</h2><p>Find a starting point. Every example opens as an editable diagram.</p></div><button type="button" data-close aria-label="Close examples">×</button></div><label class="example-search">Search examples<input type="search" placeholder="Try IAM, networking, Kubernetes, or approval…" autocomplete="off"></label><div class="example-layout"><nav class="example-navigation" aria-label="Example categories"></nav><div class="example-results"><div class="example-results-heading"><h3 data-heading>All examples</h3><span data-count role="status" aria-live="polite"></span></div><div data-results></div></div></div>`;
    const find = <T extends HTMLElement>(selector: string): T => {
      const result = dialog.querySelector<T>(selector);
      if (!result) throw Error('Missing example browser control');
      return result;
    };
    const search = find<HTMLInputElement>('input');
    const navigation = find<HTMLElement>('nav');
    const results = find<HTMLElement>('[data-results]');
    const count = find<HTMLElement>('[data-count]');
    const heading = find<HTMLElement>('[data-heading]');
    const buttons: {
      button: HTMLButtonElement;
      category: string;
      subcategory: string;
    }[] = [];
    let category = '';
    let subcategory = '';
    function filterButton(
      name: string,
      categoryName: string,
      subcategoryName = '',
    ) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = subcategoryName
        ? 'example-subcategory'
        : 'example-category';
      const label = document.createElement('span');
      label.textContent = name;
      const total = document.createElement('span');
      total.className = 'example-category-count';
      total.textContent = String(
        findExamples('', categoryName, subcategoryName).length,
      );
      button.append(label, total);
      button.onclick = () => {
        category = categoryName;
        subcategory = subcategoryName;
        render();
      };
      buttons.push({
        button,
        category: categoryName,
        subcategory: subcategoryName,
      });
      return button;
    }
    navigation.append(filterButton('All examples', ''));
    for (const group of exampleCategories) {
      const section = document.createElement('div');
      section.className = 'example-category-section';
      section.append(filterButton(group.name, group.name));
      for (const name of group.subcategories)
        section.append(filterButton(name, group.name, name));
      navigation.append(section);
    }
    function render() {
      const matches = findExamples(search.value, category, subcategory);
      heading.textContent =
        [category, subcategory].filter(Boolean).join(' / ') || 'All examples';
      count.textContent = `${matches.length} ${matches.length === 1 ? 'example' : 'examples'}`;
      for (const item of buttons)
        item.button.setAttribute(
          'aria-pressed',
          String(
            item.category === category && item.subcategory === subcategory,
          ),
        );
      results.replaceChildren();
      for (const group of exampleCategories) {
        for (const name of group.subcategories) {
          const examples = matches.filter(
            (t) => t.category === group.name && t.subcategory === name,
          );
          if (!examples.length) continue;
          const section = document.createElement('section');
          section.className = 'example-section';
          const title = document.createElement('h4');
          title.textContent = `${group.name} / ${name}`;
          const cards = document.createElement('div');
          cards.className = 'example-cards';
          for (const example of examples) {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'example-card';
            card.dataset.example = example.id;
            card.setAttribute('aria-label', `Open ${example.name}`);
            const label = document.createElement('strong');
            label.textContent = example.name;
            const description = document.createElement('span');
            description.textContent = example.description;
            card.append(label, description);
            card.onclick = () => dialog.close(example.id);
            cards.append(card);
          }
          section.append(title, cards);
          results.append(section);
        }
      }
      if (!matches.length) {
        const empty = document.createElement('p');
        empty.className = 'example-empty';
        empty.textContent =
          'No examples found. Try another search or browse all examples.';
        const reset = document.createElement('button');
        reset.textContent = 'Show all examples';
        reset.onclick = () => {
          search.value = '';
          category = '';
          subcategory = '';
          render();
          search.focus();
        };
        results.append(empty, reset);
      }
      results.parentElement?.scrollTo({ top: 0 });
    }
    search.oninput = render;
    find<HTMLButtonElement>('[data-close]').onclick = () => dialog.close();
    // Keep board shortcuts from editing the underlying diagram while browsing.
    dialog.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter' && event.target === search) {
        event.preventDefault();
        results.querySelector<HTMLButtonElement>('[data-example]')?.click();
      }
    });
    for (const type of ['copy', 'cut', 'paste'])
      dialog.addEventListener(type, (event) => event.stopPropagation());
    dialog.onclose = () => {
      resolve(templates.find((t) => t.id === dialog.returnValue) ?? null);
      dialog.remove();
    };
    document.body.append(dialog);
    render();
    dialog.showModal();
    search.focus();
  });
}
