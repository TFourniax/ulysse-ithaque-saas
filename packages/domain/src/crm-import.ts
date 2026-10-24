import type { OpportunityFields } from './opportunity.ts';

/** File imports use the existing source/analysis pipeline, never a second agent loop. */
export const CRM_FILE_PROVIDER = 'crm-file';
export type CrmColumnRole =
  | 'ignore'
  | 'title'
  | 'company'
  | 'externalId'
  | 'pipeline'
  | 'stage'
  | 'amount'
  | 'currency'
  | 'lastInteractionAt'
  | 'nextStep'
  | 'nextStepDueAt'
  | 'ownerName'
  | 'segment'
  | 'opposed'
  | 'pauseUntil'
  | 'visibility'
  | 'facts'
  | 'hypotheses'
  | 'objectives'
  | 'risks'
  | 'competitors'
  | 'history';
export type CrmColumn = { index: number; label: string; role: CrmColumnRole };
export type CrmImportRow = {
  row: number;
  title: string;
  company: string;
  identity: string;
  sourceId: string | null;
  fields: OpportunityFields | null;
  errors: string[];
  warnings: string[];
};
export type CrmFile = { columns: CrmColumn[]; rows: CrmImportRow[]; delimiter: string };
export type CrmMatch = CrmImportRow & {
  action: 'create' | 'update' | 'unchanged' | 'choose' | 'invalid';
  targetId: string | null;
  choices: { id: string; title: string; company: string }[];
};
export type CrmPreview = {
  id: string;
  connectionId: string | null;
  filename: string;
  columns: CrmColumn[];
  rows: CrmMatch[];
  missing: number;
  expiresAt: string;
};
export type CrmResolution = { row: number; target: string };
