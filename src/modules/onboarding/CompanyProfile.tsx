import React, { useState } from 'react';
import { Building2, MapPin, Phone, Mail, RefreshCw, Save } from 'lucide-react';
import type { CompanyData } from '../../types/onboarding';
import { saveCompanyProfile } from '../../services/onboardingService';

interface Props {
  company: CompanyData | null;
  onSaved: (company: CompanyData) => void;
}

const emptyCompany: CompanyData = {
  cnpj: '', razaoSocial: '', nomeFantasia: '', situacaoCadastral: '', dataInicioAtividade: '',
  atividadePrincipal: '', endereco: { logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '', cep: '' },
  telefone: '', email: '', source: 'manual',
};

// Standalone "edit company data later" screen, reachable from Configurações —
// same fields the onboarding wizard collects, but without the wizard/credit flow.
const CompanyProfile: React.FC<Props> = ({ company, onSaved }) => {
  const [form, setForm] = useState<CompanyData>(company ?? emptyCompany);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const input = (val: string, set: (v: string) => void, ph?: string) => (
    <input
      value={val}
      onChange={(e) => set(e.target.value)}
      placeholder={ph}
      className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF5B03]/30 focus:border-[#FF5B03] transition-all"
    />
  );

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await saveCompanyProfile(form);
      setSaved(true);
      onSaved(form);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar dados da empresa');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-2 mb-5">
        <Building2 className="w-5 h-5 text-[#FF5B03]" />
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Dados da empresa</h1>
          <p className="text-sm text-slate-500 mt-0.5">Usados nas suas descrições, notas fiscais e integrações.</p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-5">
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">CNPJ</label>
          {input(form.cnpj, (v) => setForm({ ...form, cnpj: v }))}
        </div>
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">Razão social</label>
          {input(form.razaoSocial, (v) => setForm({ ...form, razaoSocial: v }))}
        </div>
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">Nome fantasia</label>
          {input(form.nomeFantasia, (v) => setForm({ ...form, nomeFantasia: v }))}
        </div>
        <div className="flex items-center gap-2 text-slate-500 text-xs font-bold uppercase tracking-wider pt-2">
          <MapPin className="w-3.5 h-3.5" /> Endereço
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            {input(form.endereco.logradouro, (v) => setForm({ ...form, endereco: { ...form.endereco, logradouro: v } }), 'Logradouro')}
          </div>
          {input(form.endereco.numero, (v) => setForm({ ...form, endereco: { ...form.endereco, numero: v } }), 'Número')}
          {input(form.endereco.bairro, (v) => setForm({ ...form, endereco: { ...form.endereco, bairro: v } }), 'Bairro')}
          {input(form.endereco.cidade, (v) => setForm({ ...form, endereco: { ...form.endereco, cidade: v } }), 'Cidade')}
          {input(form.endereco.uf, (v) => setForm({ ...form, endereco: { ...form.endereco, uf: v.toUpperCase().slice(0, 2) } }), 'UF')}
          {input(form.endereco.cep, (v) => setForm({ ...form, endereco: { ...form.endereco, cep: v } }), 'CEP')}
        </div>
        <div className="grid grid-cols-2 gap-3 pt-2">
          <div>
            <label className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 mb-1.5"><Phone className="w-3.5 h-3.5" /> Telefone</label>
            {input(form.telefone, (v) => setForm({ ...form, telefone: v }))}
          </div>
          <div>
            <label className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 mb-1.5"><Mail className="w-3.5 h-3.5" /> E-mail</label>
            {input(form.email, (v) => setForm({ ...form, email: v }))}
          </div>
        </div>

        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</div>}
        {saved && <div className="text-sm text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">Dados salvos!</div>}

        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-5 py-2.5 text-sm font-semibold text-white bg-[#FF5B03] hover:bg-[#E14E00] disabled:opacity-60 rounded-xl shadow-sm transition-colors"
          >
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
};

export default CompanyProfile;
