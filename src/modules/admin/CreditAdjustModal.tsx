// Ajuste manual de créditos. O aumento de saldo só é possível aqui: a regra
// creditsNotIncreased() do Firestore impede o próprio cliente de se creditar, e
// só o Admin SDK (que bypassa as rules) consegue subir o número.
//
// Motivo é obrigatório de propósito — ajuste sem rastro é como um CRM apodrece.

import { useState } from 'react';
import { adjustCredits } from '../../services/adminService';

export default function CreditAdjustModal({
  uid,
  currentCredits,
  onClose,
  onDone,
}: {
  uid: string;
  currentCredits: number;
  onClose: () => void;
  onDone: (credits: number) => void;
}) {
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const parsed = Number(delta);
  const valid = Number.isFinite(parsed) && parsed !== 0 && reason.trim().length > 0;
  const resulting = Number.isFinite(parsed) ? currentCredits + parsed : currentCredits;

  async function submit() {
    if (!valid) return;
    setSaving(true);
    setError('');
    try {
      const { credits } = await adjustCredits(uid, parsed, reason.trim());
      onDone(credits);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl w-full max-w-md p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-bold text-slate-800">Ajustar créditos</h2>
        <p className="mt-1 text-sm text-slate-500">
          Saldo atual: <strong className="text-slate-700">{currentCredits}</strong>
        </p>

        <label className="block mt-4 text-xs font-bold text-slate-500 uppercase tracking-wide">
          Quantidade (use negativo para remover)
        </label>
        <input
          type="number"
          value={delta}
          onChange={(e) => setDelta(e.target.value)}
          placeholder="Ex.: 50 ou -10"
          className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-400"
        />

        <label className="block mt-3 text-xs font-bold text-slate-500 uppercase tracking-wide">Motivo</label>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ex.: cortesia por erro na geração"
          className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-400"
        />

        {Number.isFinite(parsed) && parsed !== 0 && (
          <p className="mt-3 text-sm text-slate-600">
            Saldo depois do ajuste: <strong className={resulting < 0 ? 'text-rose-600' : 'text-slate-800'}>{resulting}</strong>
          </p>
        )}

        {error && (
          <p className="mt-3 px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">
            {error}
          </p>
        )}

        <p className="mt-3 text-xs text-slate-400">
          Todo ajuste fica registrado no histórico de créditos do cliente e na auditoria do CRM.
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={!valid || saving}
            className="px-3 py-2 rounded-lg bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-40"
          >
            {saving ? 'Aplicando…' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
}
