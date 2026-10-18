import cases from './cases.json';

// Явный интерфейс вместо вывода типа из JSON: поле `hidden` есть только у
// снятых с продажи кейсов, а union-вывод из JSON ломает type-guard-хелперы.
export interface CaseDefinition {
  id: string;
  name: string;
  /** Временно снят с витрины (на доработке): не продаётся, но остаётся в каталоге. */
  hidden?: boolean;
  description?: string;
  color?: string;
  mark?: string;
  packs: string[];
  price?: number | null;
  rewards: { key: string; weight: number }[];
}

export const CASE_CATALOG: CaseDefinition[] = cases;
export const findCase = (id: string) => CASE_CATALOG.find(c => c.id === id);
// Описание есть не у всех кейсов (поле добавлено только к новым) — достаём его безопасно.
export const caseDescription = (definition: CaseDefinition): string | undefined => definition.description;
export const isHiddenCase = (definition: CaseDefinition): boolean => Boolean(definition.hidden);
