import { useId, useState } from 'react';

export function PublicationPreview({ body }: { body: string }) {
  const titleId = useId();
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle');
  async function copy() {
    setCopyState('copying');
    try {
      await navigator.clipboard.writeText(body);
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
  }
  return (
    <section className="publication-preview" aria-labelledby={titleId}>
      <div className="publication-preview-head">
        <div>
          <h3 id={titleId}>Texte de la publication</h3>
          <p className="small muted">Seul le texte ci-dessous sera copié.</p>
        </div>
        <button
          type="button"
          className="button button-secondary"
          disabled={copyState === 'copying'}
          onClick={() => void copy()}
        >
          {copyState === 'copying' ? 'Copie en cours…' : 'Copier le texte'}
        </button>
      </div>
      <div className="publication-preview-body">{body}</div>
      <p className="small publication-copy-status" role="status">
        {copyState === 'copied' ? 'Texte copié. Relisez-le avant de le diffuser.' : ''}
      </p>
      {copyState === 'error' && (
        <div className="publication-copy-fallback">
          <p role="alert">
            La copie automatique est indisponible. Sélectionnez le texte ci-dessous pour le copier.
          </p>
          <label>
            Texte à copier manuellement
            <textarea
              readOnly
              value={body}
              rows={8}
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
        </div>
      )}
    </section>
  );
}
