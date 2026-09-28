// Escolha do provider padrão de geração de vídeo de produto (Veo/Seedance/Omni) —
// plataforma inteira, sem opção por usuário. Mesmo esqueleto de
// AutomationsView.tsx (load em useEffect, Card/ErrorBanner/Spinner de ./ui).
import { useCallback, useEffect, useState } from 'react';
import { getVideoSettings, setVideoSettings } from '../../services/adminService';
import type { VideoPlatformSettings, VideoProvider } from '../../types/crm';
import { Card, ErrorBanner, Spinner, formatDateTime } from './ui';

const OPTIONS: { value: VideoProvider; label: string; hint: string }[] = [
  { value: 'veo', label: 'Veo 3', hint: 'Google, via Vertex AI. Provider atual — validado em produção.' },
  { value: 'seedance', label: 'Seedance 2.5', hint: 'bytedance/seedance-2.5 (720p), via OpenRouter. Trocar aqui não afeta vídeos já em geração.' },
  { value: 'omni', label: 'Gemini Omni 1.1 Flash', hint: 'gemini-omni-1.1-flash-preview (720p), via Vertex AI. Áudio e fala com lip sync nativos; pt-BR não é avaliado oficialmente pela Google.' },
];

export default function VideoSettingsView() {
  const [settings, setSettings] = useState<VideoPlatformSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setSettings(await getVideoSettings());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function choose(provider: VideoProvider) {
    if (!settings || provider === settings.defaultProvider || saving) return;
    setSaving(true);
    setError('');
    try {
      setSettings(await setVideoSettings(provider));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spinner />;

  return (
    <div className="space-y-4 max-w-xl">
      {error && <ErrorBanner message={error} />}
      <Card className="p-5">
        <h2 className="text-sm font-bold text-slate-800 mb-1">Provider de geração de vídeo</h2>
        <p className="text-xs text-slate-500 mb-4">
          Vale para os dois modos (clássico e UGC com avatar), em todos os usuários. Trocar aqui não afeta
          vídeos que já estão em geração.
        </p>
        <div className="space-y-2">
          {OPTIONS.map((opt) => {
            const active = settings?.defaultProvider === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                disabled={saving}
                onClick={() => choose(opt.value)}
                className={`w-full text-left px-4 py-3 rounded-xl border transition-colors disabled:opacity-50 ${
                  active ? 'border-violet-400 bg-violet-50' : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-800">{opt.label}</span>
                  {active && <span className="text-xs font-semibold text-violet-700">selecionado</span>}
                </div>
                <p className="text-xs text-slate-500 mt-0.5">{opt.hint}</p>
              </button>
            );
          })}
        </div>
        {settings?.updatedAt && (
          <p className="text-xs text-slate-400 mt-4">
            Última alteração: {formatDateTime(settings.updatedAt)}
          </p>
        )}
      </Card>
    </div>
  );
}
