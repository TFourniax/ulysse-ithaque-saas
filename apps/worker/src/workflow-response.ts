import { WorkflowResult } from '@ulysse/contracts';
import { validateWorkflowResult } from '@ulysse/domain';
import type { WorkflowResult as Result } from '@ulysse/domain';
import { z } from 'zod';

/** The provider and the publication boundary share one closed result contract. */
export function workflowResponseFormat(kind: 'buyer' | 'content', references: string[]) {
  const allowedReferences = [...new Set(references)].sort();
  if (!allowedReferences.length) throw new Error('workflow_evidence_missing');
  const contract = WorkflowResult.extend({
    kind: z.literal(kind),
    ...(kind === 'buyer'
      ? { content: z.null() }
      : {
          uniqueness: z.null(),
          benchmark: WorkflowResult.shape.benchmark.max(0),
          buyerQuestions: WorkflowResult.shape.buyerQuestions.max(0),
        }),
  });
  const schema = z.toJSONSchema(contract, {
    target: 'draft-07',
    override: ({ jsonSchema }) => {
      const citations = jsonSchema.properties?.references;
      if (citations && typeof citations === 'object') {
        // Listing a source does not authorize citing its unread contents. Rebuilt
        // on every call, including after a tool read and during the bounded repair.
        citations.items = { type: 'string', enum: allowedReferences };
      }
    },
  });
  return {
    type: 'json_schema',
    json_schema: { name: `ulysse_${kind}_result`, strict: true, schema },
  };
}

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
  let result: Result | null = null;
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
          result = validateWorkflowResult(value);
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
  return { diagnostics, assistant, repairable: !refused, result };
}

/** Mechanical support checks; they cannot establish semantic entailment. */
export function inspectBuyerCitations(
  result: Result,
  evidence: {
    references: readonly string[];
    offerReferences: readonly string[];
    competitorReferences: readonly string[];
  },
): WorkflowFormatDiagnostic | null {
  const issues: WorkflowFormatDiagnostic['issues'] = [];
  const check = (references: readonly string[], path: string, bilateral: boolean) => {
    if (references.some((ref) => !evidence.references.includes(ref)))
      issues.push({ path, code: 'unretrieved_citation' });
    if (
      bilateral &&
      (!references.some((ref) => evidence.offerReferences.includes(ref)) ||
        !references.some((ref) => evidence.competitorReferences.includes(ref)))
    )
      issues.push({ path, code: 'bilateral_evidence_required' });
  };
  result.findings.forEach((item, i) => check(item.references, `findings.${i}.references`, false));
  result.benchmark.forEach((item, i) => check(item.references, `benchmark.${i}.references`, true));
  if (result.uniqueness)
    check(
      result.uniqueness.references,
      'uniqueness.references',
      result.uniqueness.verdict !== 'insufficient_evidence',
    );
  return issues.length
    ? { code: 'result_evidence_invalid', finishReason: 'stop', issues: issues.slice(0, 8) }
    : null;
}

export function workflowRepairPrompt(
  d: WorkflowFormatDiagnostic,
  kind: 'buyer' | 'content',
): string {
  if (d.code === 'result_evidence_invalid')
    return `Ulysse a refusé les références du diagnostic : ${JSON.stringify(d)}. Une seule correction est autorisée. Chaque ligne comparative et chaque verdict d'unicité affirmatif doit citer une source de notre offre et une source concurrente effectivement fournies, pertinentes pour la comparaison. Une citation ajoutée ne rend pas une affirmation vraie : réécris les affirmations non étayées, limite les absences aux extraits consultés et ne classe pas les prix inconnus ou incomparables. Aucun outil. Retourne uniquement le résultat complet corrigé, au même schéma; si aucune comparaison n'est étayée, une abstention conforme et explicite.`;
  return `Ulysse a refusé le FORMAT du résultat ${kind} : ${JSON.stringify(d)}. Une seule correction est autorisée. Retourne uniquement l'objet JSON complet conforme au schéma des instructions, avec tous les champs requis. Conserve les faits et références déjà consultés, sans ajout ni invention. Aucune nouvelle lecture ni action. Références non vides et sans doublons. Raccourcis les textes pour terminer le JSON dans le plafond de sortie. Pour buyer : content=null; findings et uniqueness requis pour draft. Pour content : uniqueness=null, benchmark=[], buyerQuestions=[]. Pour needs_context/abstained : findings=[], benchmark=[], buyerQuestions=[], uniqueness=null, content=null. Si tu ne peux pas étayer un brouillon, retourne une abstention conforme et explicite.`;
}
