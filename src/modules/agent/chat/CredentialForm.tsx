import { useState } from 'react';
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
    <div className="border border-ink/10 rounded-xl p-4 space-y-2 bg-white">
      <p className="text-sm font-medium text-ink">Conectar {provider === 'wordpress' ? 'WordPress' : 'Sanity'}</p>
      <input
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={label}
        className="w-full border border-ink/15 rounded-lg px-3 py-2 text-sm"
      />
      <button
        disabled={saving || !value.trim()}
        onClick={handleSave}
        className="bg-orange text-white text-sm font-bold rounded-lg px-3 py-1.5 disabled:opacity-50"
      >
        {saving ? 'Salvando…' : 'Salvar'}
      </button>
    </div>
  );
}
