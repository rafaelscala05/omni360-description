// src/components/modals/AvatarLibrary.tsx
import React, { useEffect, useState } from 'react';
import { Plus, Loader2, AlertCircle, CheckCircle2, User, RefreshCw } from 'lucide-react';
import type { Avatar } from '../../types/models';
import { listAvatars, generateAvatarPortrait, uploadAvatarImage, saveAvatar, buildAvatarDescription } from '../../services/avatarService';
import type { AvatarTraits } from '../../services/avatarPrompt';
import { CREDIT_ACTIONS, type CreditAction } from '../../credits';

export interface AvatarLibraryProps {
  uid: string;
  selectedAvatarId?: string;
  onSelect: (avatar: Avatar) => void;
  // Required (not optional) so a caller can never render the library without
  // charging for portraits. Same contract as App.tsx's ensureCredits/consumeCredit.
  ensureCredits: (action: CreditAction) => boolean;
  consumeCredit: (action: CreditAction, productName?: string) => Promise<boolean>;
}

type FormState = { nome: string; detalhes: string; traits: AvatarTraits; previewDataUrl: string | null };

const TRAIT_OPTIONS: Array<{ key: keyof AvatarTraits; label: string; options: string[] }> = [
  { key: 'faixaEtaria', label: 'Faixa etária', options: ['18–24 anos', '25–34 anos', '35–44 anos', '45–54 anos', '55+ anos'] },
  { key: 'genero', label: 'Gênero', options: ['Mulher', 'Homem', 'Pessoa não binária'] },
  { key: 'etnia', label: 'Etnia/aparência', options: ['Pessoa negra', 'Pessoa branca', 'Pessoa asiática', 'Pessoa parda', 'Pessoa indígena'] },
  { key: 'estilo', label: 'Estilo', options: ['Casual descontraído', 'Elegante sofisticado', 'Fitness e esportivo', 'Criativo e moderno', 'Profissional'] },
  { key: 'tomDeVoz', label: 'Tom de voz', options: ['Animado e espontâneo', 'Calmo e acolhedor', 'Confiante e especialista', 'Divertido e próximo', 'Sofisticado e sereno'] },
];

const EMPTY_TRAITS: AvatarTraits = { faixaEtaria: '', genero: '', etnia: '', estilo: '', tomDeVoz: '' };
const emptyForm = (): FormState => ({ nome: '', detalhes: '', traits: { ...EMPTY_TRAITS }, previewDataUrl: null });

export default function AvatarLibrary({ uid, selectedAvatarId, onSelect, ensureCredits, consumeCredit }: AvatarLibraryProps) {
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listAvatars(uid)
      .then((list) => { if (!cancelled) setAvatars(list); })
      .catch((err) => { if (!cancelled) setListError(err instanceof Error ? err.message : 'Erro ao carregar avatares'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [uid]);

  async function handleGeneratePreview() {
    const descricao = buildAvatarDescription(form.traits, form.detalhes);
    if (!descricao) return;
    // Every generated portrait costs credits (a regenerate is a new generation).
    if (!ensureCredits(CREDIT_ACTIONS.avatarCreation)) return;
    setGenerating(true);
    setGenError(null);
    try {
      const dataUrl = await generateAvatarPortrait(descricao);
      // Debit only after the image was generated successfully, so a blocked or
      // failed generation never costs the user credits (same rule as ambient images).
      const paid = await consumeCredit(CREDIT_ACTIONS.avatarCreation, form.nome.trim() || 'Avatar');
      if (!paid) {
        setGenError('Não foi possível debitar os créditos do avatar. Tente novamente.');
        return;
      }
      setForm((f) => ({ ...f, previewDataUrl: dataUrl }));
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Erro ao gerar retrato do avatar');
    } finally {
      setGenerating(false);
    }
  }

  async function handleConfirmAvatar() {
    if (!form.previewDataUrl || !form.nome.trim()) return;
    setSaving(true);
    try {
      const tempId = crypto.randomUUID();
      const referenceImageUrl = await uploadAvatarImage(uid, form.previewDataUrl, tempId);
      const descricao = buildAvatarDescription(form.traits, form.detalhes);
      const avatar = await saveAvatar(uid, { nome: form.nome.trim(), descricao, referenceImageUrl }, tempId);
      setAvatars((prev) => [...prev, avatar]);
      onSelect(avatar);
      setCreating(false);
      setForm(emptyForm());
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Erro ao salvar avatar');
    } finally {
      setSaving(false);
    }
  }

  const descricaoCompleta = buildAvatarDescription(form.traits, form.detalhes);

  function updateTrait(key: keyof AvatarTraits, value: string) {
    setForm((f) => ({ ...f, traits: { ...f.traits, [key]: value }, previewDataUrl: null }));
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando avatares...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {listError && (
        <p className="text-sm text-red-600 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" /> {listError}
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {avatars.map((avatar) => {
          const selected = avatar.id === selectedAvatarId;
          return (
            <button
              key={avatar.id}
              type="button"
              onClick={() => onSelect(avatar)}
              className={`rounded-xl border-2 overflow-hidden text-left transition-all ${selected ? 'border-violet-600 ring-2 ring-violet-200' : 'border-slate-200 hover:border-violet-300'}`}
            >
              <div className="relative aspect-[3/4] bg-slate-100">
                <img src={avatar.referenceImageUrl} alt={avatar.nome} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                {selected && (
                  <span className="absolute top-2 right-2 w-6 h-6 rounded-full bg-violet-600 flex items-center justify-center">
                    <CheckCircle2 className="w-4 h-4 text-white" />
                  </span>
                )}
              </div>
              <div className="px-2 py-2">
                <p className="text-xs font-bold text-slate-700 truncate">{avatar.nome}</p>
              </div>
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded-xl border-2 border-dashed border-slate-300 hover:border-violet-400 aspect-[3/4] flex flex-col items-center justify-center gap-2 text-slate-400 hover:text-violet-600 transition-all"
        >
          <Plus className="w-6 h-6" />
          <span className="text-xs font-bold">Criar avatar</span>
        </button>
      </div>

      {avatars.length === 0 && !creating && (
        <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
          <User className="w-4 h-4 mt-0.5 shrink-0" />
          <span>Você ainda não tem nenhum avatar. Clique em "Criar avatar" para gerar o primeiro.</span>
        </div>
      )}

      {creating && (
        <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200 space-y-4">
          <h3 className="text-sm font-bold text-slate-800">Novo avatar</h3>

          <div className="space-y-1.5">
            <label className="text-sm font-bold text-slate-800">Nome</label>
            <input
              type="text"
              value={form.nome}
              onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
              placeholder="Ex.: Ana — Jovem Casual"
              className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-bold text-slate-800">Características</label>
            <p className="text-xs text-slate-400">Escolha uma opção em cada campo. Elas serão usadas no retrato e na personalidade e voz do vídeo UGC.</p>
            <div className="space-y-3 pt-1">
              {TRAIT_OPTIONS.map(({ key, label, options }) => (
                <div key={key}>
                  <label className="block text-xs font-bold text-slate-600 mb-1.5">{label}</label>
                  <select
                    value={form.traits[key]}
                    onChange={(e) => updateTrait(key, e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500"
                  >
                    <option value="">Selecionar</option>
                    {options.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <textarea
              value={form.detalhes}
              onChange={(e) => setForm((f) => ({ ...f, detalhes: e.target.value, previewDataUrl: null }))}
              rows={2}
              placeholder="Detalhes adicionais (opcional): cabelo cacheado castanho, usa óculos..."
              className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 resize-none outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500"
            />
            {descricaoCompleta && <p className="text-xs text-slate-500 bg-violet-50 border border-violet-100 rounded-lg p-2.5"><span className="font-bold text-violet-700">Resumo para IA: </span>{descricaoCompleta}</p>}
          </div>

          {genError && (
            <p className="text-sm text-red-600 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" /> {genError}
            </p>
          )}

          {form.previewDataUrl && (
            <div className="w-40 rounded-xl overflow-hidden border border-slate-200">
              <img src={form.previewDataUrl} alt="Preview do avatar" className="w-full aspect-[3/4] object-cover" />
            </div>
          )}

          <div className="flex gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => { setCreating(false); setForm(emptyForm()); setGenError(null); }}
              className="px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-bold hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleGeneratePreview}
              disabled={!descricaoCompleta || generating}
              className="px-4 py-2.5 border border-violet-200 text-violet-700 rounded-xl text-sm font-bold hover:bg-violet-50 disabled:opacity-40 flex items-center gap-2"
            >
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {form.previewDataUrl ? 'Gerar novamente' : 'Gerar retrato'}
            </button>
            <button
              type="button"
              onClick={handleConfirmAvatar}
              disabled={!form.previewDataUrl || !form.nome.trim() || saving}
              className="px-6 py-2.5 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-xl text-sm font-bold shadow-md disabled:opacity-40 flex items-center gap-2"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {saving ? 'Salvando...' : 'Confirmar avatar'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
