interface PreviewField { campo: string; antes: unknown; depois: unknown; mudou: boolean }
export interface ApprovalPreview {
  ferramenta?: string;
  resumo?: string;
  alvo?: string;
  campos?: PreviewField[];
  avisos?: string[];
}

export function ApprovalCard({
  preview, onDecide,
}: {
  preview: ApprovalPreview;
  onDecide: (aprovado: boolean) => void;
}) {
  return (
    <div className="border border-orange/30 bg-orange/5 rounded-xl p-4 space-y-3">
      <p className="font-medium text-ink">{preview.resumo ?? 'Confirmar ação?'}</p>
      {preview.alvo && <p className="text-xs text-slate-500">Alvo: {preview.alvo}</p>}
      {!!preview.campos?.length && (
        <table className="w-full text-xs">
          <tbody>
            {preview.campos.map((c) => (
              <tr key={c.campo} className={c.mudou ? 'font-medium' : 'text-slate-400'}>
                <td className="pr-2">{c.campo}</td>
                <td className="pr-2">{String(c.antes ?? '—')}</td>
                <td>→ {String(c.depois ?? '—')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {preview.avisos?.map((a, i) => <p key={i} className="text-xs text-amber-600">⚠ {a}</p>)}
      <div className="flex gap-2 pt-1">
        <button
          className="bg-orange text-white text-sm font-bold rounded-lg px-3 py-1.5"
          onClick={() => onDecide(true)}
        >
          Aprovar
        </button>
        <button
          className="border border-ink/20 text-ink text-sm rounded-lg px-3 py-1.5"
          onClick={() => onDecide(false)}
        >
          Rejeitar
        </button>
      </div>
    </div>
  );
}
