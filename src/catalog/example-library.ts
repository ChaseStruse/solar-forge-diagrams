import { templates } from './templates';

export const exampleCategories = [...new Set(templates.map((t) => t.category))]
  .sort()
  .map((name) => ({
    name,
    subcategories: [
      ...new Set(
        templates.filter((t) => t.category === name).map((t) => t.subcategory),
      ),
    ].sort(),
  }));

export function findExamples(query = '', category = '', subcategory = '') {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/u).filter(Boolean);
  return templates
    .filter((template) => {
      if (category && template.category !== category) return false;
      if (subcategory && template.subcategory !== subcategory) return false;
      const text =
        `${template.name} ${template.description} ${template.category} ${template.subcategory}`.toLocaleLowerCase();
      return terms.every((term) => text.includes(term));
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
