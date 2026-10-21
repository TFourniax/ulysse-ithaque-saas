import { WorkflowResult } from '@ulysse/contracts';
import { validateWorkflowResult } from '@ulysse/domain';
import { z } from 'zod';

const PATH_FIELDS = new Set([
  'version',
  'kind',
  'outcome',
  'summary',
  'questions',
  'findings',
  'benchmark',
  'buyerQuestions',
  'uniqueness',
  'content',
  'limits',
  'topic',
  'analysis',
  'references',
  'verdict',
  'reason',
  'title',
  'body',
  'callToAction',
  'rationale',
]);
export type WorkflowFormatDiagnostic = {
  code: string;
  finishReason: string;
  issues: { path: string; code: string }[];
};
/** Only fixed schema paths and issue codes may be persisted, never values or unknown field names. */
export function inspectWorkflowCompletion(payload: unknown, kind: 'buyer' | 'content') {
  const envelope = z
    .object({
      choices: z
        .array(
          z.object({
            finish_reason: z.string().nullable().optional(),
            message: z
              .object({
                content: z.string().nullable().optional(),
                tool_calls: z.array(z.unknown()).optional(),
              })
              .loose(),
          }),
        )
        .min(1),
    })
    .safeParse(payload);
  if (!envelope.success) return null;
  const choice = envelope.data.choices[0];
  if (!choice) return null;
  if (choice.message.tool_calls?.length) return null;
  const finish = z
    .enum(['stop', 'length', 'tool_calls', 'content_filter', 'error'])
    .safeParse(choice.finish_reason);
  const diagnostics: WorkflowFormatDiagnostic = {
    code: 'validated',
    finishReason: finish.success ? finish.data : 'unknown',
    issues: [],
  };
  const refused =
    diagnostics.finishReason === 'content_filter' ||
    diagnostics.finishReason === 'error' ||
    (typeof choice.message.refusal === 'string' && choice.message.refusal.length > 0);
  if (!refused && typeof choice.message.content !== 'string') return null;
  const text = choice.message.content ?? '';
  if (refused) diagnostics.code = 'result_refused';
  else if (diagnostics.finishReason === 'length') diagnostics.code = 'result_truncated';
  else if (text.length > 20000) diagnostics.code = 'result_too_large';
  else {
    const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(text.trim());
    let value: unknown;
    try {
      value = JSON.parse(fenced?.[1] ?? text.trim());
    } catch {
      diagnostics.code = 'result_json_invalid';
    }
    if (diagnostics.code === 'validated') {
      const shape = WorkflowResult.safeParse(value);
      if (!shape.success) {
        diagnostics.code = 'result_schema_invalid';
        diagnostics.issues = shape.error.issues.slice(0, 8).map((issue) => ({
          path:
            issue.path
              .map((p) =>
                typeof p === 'number' && p >= 0 && p < 100
                  ? String(p)
                  : typeof p === 'string' && PATH_FIELDS.has(p)
                    ? p
                    : 'field',
              )
              .join('.') || 'result',
          code: issue.code,
        }));
      } else if (shape.data.kind !== kind) {
        diagnostics.code = 'result_kind_invalid';
        diagnostics.issues = [{ path: 'kind', code: 'invalid_value' }];
      } else {
        try {
          validateWorkflowResult(value);
        } catch {
          diagnostics.code = 'result_semantics_invalid';
        }
      }
    }
  }
  // Preserve opaque reasoning replay fields for models that require exact continuation.
  const assistant: Record<string, unknown> = { role: 'assistant', content: text };
  for (const key of ['reasoning', 'reasoning_content', 'reasoning_details'])
    if (choice.message[key] !== undefined) assistant[key] = choice.message[key];
  return { diagnostics, assistant, repairable: !refused };
}

export function workflowRepairPrompt(
  d: WorkflowFormatDiagnostic,
  kind: 'buyer' | 'content',
): string {
  return `Ulysse a refusé le FORMAT du résultat ${kind} : ${JSON.stringify(d)}. Une seule correction est autorisée. Retourne uniquement l'objet JSON complet conforme au schéma des instructions, avec tous les champs requis. Conserve les faits et références déjà consultés, sans ajout ni invention. Aucune nouvelle lecture ni action. Références non vides et sans doublons. Raccourcis les textes pour terminer le JSON dans le plafond de sortie. Pour buyer : content=null; findings et uniqueness requis pour draft. Pour content : uniqueness=null, benchmark=[], buyerQuestions=[]. Pour needs_context/abstained : findings=[], benchmark=[], buyerQuestions=[], uniqueness=null, content=null. Si tu ne peux pas étayer un brouillon, retourne une abstention conforme et explicite.`;
}
