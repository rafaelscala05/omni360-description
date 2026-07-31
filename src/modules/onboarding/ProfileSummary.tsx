import React from 'react';
import { Briefcase, Building2, Users2, Globe, Phone, Mail, User as UserIcon } from 'lucide-react';
import type { CompanyData, OnboardingContact, OnboardingStep1 } from '../../types/onboarding';

const Row: React.FC<{ icon: React.ReactNode; label: string; children: React.ReactNode }> = ({ icon, label, children }) => (
  <div className="flex gap-3 py-3 border-b border-slate-100 last:border-0">
    <div className="text-slate-400 mt-0.5 shrink-0">{icon}</div>
    <div className="min-w-0 flex-1">
      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">{label}</div>
      {children}
    </div>
  </div>
);

const ProfileSummary: React.FC<{ step1: OnboardingStep1; company: CompanyData | null; contact: OnboardingContact }> = ({
  step1,
  company,
  contact,
}) => (
  <div className="bg-white border border-slate-200 rounded-2xl shadow-sm divide-y divide-slate-100 px-5">
    <Row icon={<Briefcase className="w-4 h-4" />} label="Função">
      <p className="text-sm font-semibold text-slate-900">{step1.role || '—'}</p>
    </Row>
    <Row icon={<Users2 className="w-4 h-4" />} label="Área de atuação / porte">
      <p className="text-sm text-slate-700">{step1.industry || '—'} {step1.companySize ? `· ${step1.companySize} funcionários` : ''}</p>
    </Row>
    <Row icon={<Globe className="w-4 h-4" />} label="E-commerce">
      <p className="text-sm text-slate-700">{step1.ecommerceUrl || '—'}</p>
    </Row>
    <Row icon={<Building2 className="w-4 h-4" />} label="Empresa">
      <p className="text-sm font-semibold text-slate-900">{company?.razaoSocial || '—'}</p>
      {company?.cnpj && <p className="text-sm text-slate-500 mt-0.5">CNPJ: {company.cnpj}</p>}
    </Row>
    <Row icon={<UserIcon className="w-4 h-4" />} label="Contato">
      <p className="text-sm text-slate-700">{contact.firstName} {contact.lastName}</p>
    </Row>
    <Row icon={<Phone className="w-4 h-4" />} label="WhatsApp">
      <p className="text-sm text-slate-700">{contact.whatsapp || '—'}</p>
    </Row>
    <Row icon={<Mail className="w-4 h-4" />} label="E-mail corporativo">
      <p className="text-sm text-slate-700">{contact.corporateEmail || '—'}</p>
    </Row>
  </div>
);

export default ProfileSummary;
