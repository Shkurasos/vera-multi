import cases from './cases.json';

export const CASE_CATALOG = cases;
export type CaseDefinition = typeof CASE_CATALOG[number];
export const findCase = (id: string) => CASE_CATALOG.find(c => c.id === id);
