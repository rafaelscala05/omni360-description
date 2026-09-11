import { useState } from 'react';
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { saveWordpressSecret, saveSanitySecret } from '../../../services/contentService';

export function CredentialForm({
  uid, provider, projectId, onDone,
}: { uid: string; provider: 'wordpress' | 'sanity'; projectId: string; onDone: (ok: boolean) => void }) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  const label = provider === 'wordpress' ? 'Senha de aplicativo do WordPress' : 'Token de API do Sanity';

  const handleSave = async () => {
    setSaving(true);
    try {
      if (provider === 'wordpress') await saveWordpressSecret(uid, projectId, value);
      else await saveSanitySecret(uid, projectId, value);
      onDone(true);
    } catch {
      onDone(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="ag-glass rounded-[20px] p-4 space-y-3"
      style={{ borderColor: 'var(--ag-accent)', boxShadow: '0 0 0 4px var(--ag-accent-soft), var(--ag-shadow)' }}
    >
      <div className="flex items-center gap-2">
        <span
          className="w-8 h-8 rounded-xl grid place-items-center shrink-0"
          style={{ background: 'var(--ag-accent-soft)', color: 'var(--ag-accent)' }}
        >
          <KeyRound className="w-4 h-4" />
        </span>
        <div>
          <p className="text-[14px] font-semibold text-[var(--ag-text)] leading-tight">
            Conectar {provider === 'wordpress' ? 'WordPress' : 'Sanity'}
          </p>
          <p className="text-[11px] text-[var(--ag-text-3)] leading-tight">{label}</p>
        </div>
      </div>

      <input
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && value.trim() && !saving) void handleSave(); }}
        placeholder={label}
        className="w-full rounded-xl px-3.5 py-2.5 text-[14px] text-[var(--ag-text)] placeholder:text-[var(--ag-text-3)] focus:outline-none transition-shadow"
        style={{ background: 'var(--ag-fill)', border: '1px solid var(--ag-hairline)' }}
      />

      <div className="flex items-center gap-2">
        <button
          disabled={saving || !value.trim()}
          onClick={handleSave}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-[13px] font-semibold transition-transform active:scale-95 disabled:opacity-50"
          style={{ background: 'var(--ag-accent)', color: 'var(--ag-accent-ink)' }}
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          {saving ? 'Salvando…' : 'Salvar'}
        </button>
        <span className="flex items-center gap-1.5 text-[11px] text-[var(--ag-text-3)]">
          <ShieldCheck className="w-3.5 h-3.5" />
          A credencial vai direto para o cofre — o modelo nunca a vê.
        </span>
      </div>
    </div>
  );
}
