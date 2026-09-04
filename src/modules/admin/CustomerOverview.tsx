// Aba "Visão geral": tudo o que o cliente informou — cadastro, respostas do
// onboarding e dados da empresa vindos do CNPJ.

import type { ReactNode } from 'react';
import type { CustomerDetailPayload } from '../../types/crm';
import { Card, formatDate, whatsappHref } from './ui';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 py-1.5 border-b border-slate-100 last:border-0">
      <span className="w-40 shrink-0 text-xs text-slate-400 pt-0.5">{label}</span>
      <span className="text-sm text-slate-700 min-w-0 break-words">{children}</span>
    </div>
  );
}

function str(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return s.trim() || '—';
}

function formatCnpj(raw: unknown): string {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length !== 14) return str(raw);
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

export default function CustomerOverview({ customer }: { customer: CustomerDetailPayload }) {
  const onboarding = customer.onboarding;
  const step1 = onboarding?.step1 ?? null;
  const contact = (onboarding?.contact ?? null) as Record<string, unknown> | null;
  const company = customer.company;
  const endereco = (company?.endereco ?? null) as Record<string, unknown> | null;

  const ecommerceUrl = str(step1?.ecommerceUrl);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="p-5">
        <h2 className="text-sm font-bold text-slate-700 mb-3">Conta</h2>
        <Row label="Nome">{str(customer.displayName)}</Row>
        <Row label="E-mail">{str(customer.email)}</Row>
        <Row label="Telefone">
          {whatsappHref(customer.whatsapp) ? (
            <a
              href={whatsappHref(customer.whatsapp)!}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-emerald-600 hover:text-emerald-800"
            >
              {customer.whatsapp}
            </a>
          ) : (
            str(customer.whatsapp)
          )}
        </Row>
        <Row label="Primeiro acesso">{formatDate(customer.createdAt)}</Row>
        <Row label="Créditos">{customer.credits}</Row>
        <Row label="Código de indicação">{str(customer.referralCode)}</Row>
        <Row label="Indicado por">{str(customer.referredBy)}</Row>
        <Row label="UID">
          <code className="text-xs text-slate-500">{customer.uid}</code>
        </Row>
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-bold text-slate-700 mb-3">Onboarding</h2>
        {!onboarding?.completed ? (
          <p className="text-sm text-slate-400">Onboarding não concluído.</p>
        ) : (
          <>
            <Row label="Concluído em">{formatDate(onboarding.completedAt)}</Row>
            <Row label="Cargo">{str(step1?.role)}</Row>
            <Row label="Segmento">{str(step1?.industry)}</Row>
            <Row label="Tamanho da empresa">{str(step1?.companySize)}</Row>
            <Row label="Loja">
              {ecommerceUrl === '—' ? (
                '—'
              ) : (
                <a
                  href={ecommerceUrl.startsWith('http') ? ecommerceUrl : `https://${ecommerceUrl}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-violet-600 hover:text-violet-800 font-medium"
                >
                  {ecommerceUrl}
                </a>
              )}
            </Row>
            <Row label="Nome do contato">
              {`${str(contact?.firstName)} ${contact?.lastName ? String(contact.lastName) : ''}`.trim()}
            </Row>
            <Row label="WhatsApp">{str(contact?.whatsapp)}</Row>
            <Row label="E-mail corporativo">
              {contact?.sameAsAccountEmail === true ? str(customer.email) : str(contact?.corporateEmail)}
            </Row>
          </>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-bold text-slate-700 mb-3">Empresa</h2>
        {!company ? (
          <p className="text-sm text-slate-400">Nenhum CNPJ informado.</p>
        ) : (
          <>
            <Row label="CNPJ">{formatCnpj(company.cnpj)}</Row>
            <Row label="Razão social">{str(company.razaoSocial)}</Row>
            <Row label="Nome fantasia">{str(company.nomeFantasia)}</Row>
            <Row label="Situação cadastral">{str(company.situacaoCadastral)}</Row>
            <Row label="Início da atividade">{str(company.dataInicioAtividade)}</Row>
            <Row label="Atividade principal">{str(company.atividadePrincipal)}</Row>
            <Row label="Telefone">{str(company.telefone)}</Row>
            <Row label="E-mail">{str(company.email)}</Row>
            <Row label="Endereço">
              {endereco
                ? [
                    [str(endereco.logradouro), str(endereco.numero)].filter((v) => v !== '—').join(', '),
                    endereco.complemento ? String(endereco.complemento) : '',
                    endereco.bairro ? String(endereco.bairro) : '',
                    [endereco.cidade, endereco.uf].filter(Boolean).join('/'),
                    endereco.cep ? `CEP ${String(endereco.cep)}` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ') || '—'
                : '—'}
            </Row>
            <Row label="Origem">{company.source === 'cnpj.ws' ? 'Consulta automática' : 'Preenchido à mão'}</Row>
          </>
        )}
      </Card>
    </div>
  );
}
