import type { CrmAdjustmentsDto, CrmPreviewDto } from '@ulysse/contracts';

type Props = {
  row: CrmPreviewDto['rows'][number];
  columns: CrmPreviewDto['columns'];
  adjustments: CrmAdjustmentsDto;
  disabled: boolean;
  onChange: (value: CrmAdjustmentsDto) => void;
};
const PRIMARY = new Set([
  'title',
  'company',
  'amount',
  'currency',
  'stage',
  'nextStep',
  'nextStepDueAt',
  'lastInteractionAt',
]);

export function CrmImportRowEditor({ row, columns, adjustments, disabled, onChange }: Props) {
  const cells = row.editableCells ?? [];
  if (!cells.length) return null;
  const input = (cell: (typeof cells)[number]) => {
    const column = columns.find((c) => c.index === cell.column);
    if (!column) return null;
    const value =
      adjustments.cells?.find((e) => e.row === row.row && e.column === cell.column)?.value ??
      cell.original;
    const update = (value: string) =>
      onChange({
        ...adjustments,
        cells: [
          ...(adjustments.cells ?? []).filter((e) => e.row !== row.row || e.column !== cell.column),
          ...(value === cell.original ? [] : [{ row: row.row, column: cell.column, value }]),
        ],
      });
    return (
      <label key={cell.column}>
        {column.label}
        <textarea
          rows={PRIMARY.has(column.role) && column.role !== 'nextStep' ? 1 : 3}
          aria-label={`${column.label} — ligne ${row.row}`}
          value={value}
          disabled={disabled}
          maxLength={48000}
          onChange={(e) => update(e.target.value)}
        />
        {value !== cell.original && (
          <span className="small muted">Dans le fichier : {cell.original || '(vide)'}</span>
        )}
      </label>
    );
  };
  return (
    <details className="crm-edit">
      <summary>Corriger cette affaire</summary>
      <p className="small">
        Vous pouvez corriger les valeurs ou laisser un montant inconnu vide. Vérifiez ensuite
        l’aperçu avant d’importer.
      </p>
      <div className="crm-edit-fields">
        {cells
          .filter((c) => PRIMARY.has(columns.find((col) => col.index === c.column)?.role ?? ''))
          .map(input)}
        {columns.some((c) => c.role === 'amount') && (
          <label>
            Corriger la devise de cette affaire
            <input
              aria-label={`Devise corrigée — ligne ${row.row}`}
              maxLength={3}
              placeholder="Automatique"
              value={adjustments.rowCurrencies?.find((e) => e.row === row.row)?.currency ?? ''}
              disabled={disabled}
              onChange={(e) =>
                onChange({
                  ...adjustments,
                  rowCurrencies: [
                    ...(adjustments.rowCurrencies ?? []).filter((v) => v.row !== row.row),
                    ...(e.target.value
                      ? [{ row: row.row, currency: e.target.value.toUpperCase() }]
                      : []),
                  ],
                })
              }
            />
            <span className="small muted">
              Code à trois lettres : EUR, USD… Corrige le libellé, sans convertir le montant.
            </span>
          </label>
        )}
      </div>
      {cells.some(
        (c) => !PRIMARY.has(columns.find((col) => col.index === c.column)?.role ?? ''),
      ) && (
        <details>
          <summary>Autres informations de cette affaire</summary>
          <div className="crm-edit-fields">
            {cells
              .filter(
                (c) => !PRIMARY.has(columns.find((col) => col.index === c.column)?.role ?? ''),
              )
              .map(input)}
          </div>
        </details>
      )}
    </details>
  );
}
