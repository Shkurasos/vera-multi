import cases from './cases.json';

export const CASE_CATALOG = cases;
export type CaseDefinition = typeof CASE_CATALOG[number];
export const findCase = (id: string) => CASE_CATALOG.find(c => c.id === id);
// Описание есть не у всех кейсов (поле добавлено только к новым) — достаём его безопасно.
export const caseDescription = (definition: CaseDefinition): string | undefined =>
  (definition as { description?: string }).description;
