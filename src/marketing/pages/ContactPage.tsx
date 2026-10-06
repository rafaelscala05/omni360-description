import { FormEvent, useState } from 'react';
import Hero from '../components/Hero';
import Section from '../components/Section';
import { saveLead, LeadInput } from '../leadService';
import { usePageMeta } from '../usePageMeta';
import { linkCadastro } from '../objetivoSite';
import { trackContactLead } from '../../analytics';

type Status = 'idle' | 'sending' | 'done' | 'error';

const emptyForm: LeadInput = { nome: '', email: '', mensagem: '' };

export default function ContactPage() {
  usePageMeta({
    title: 'Contato | Alfreds',
    description: 'Fale com um especialista do Alfreds.'
  });

  const [form, setForm] = useState<LeadInput>(emptyForm);
  const [status, setStatus] = useState<Status>('idle');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setStatus('sending');
    try {
      await saveLead(form);
      trackContactLead();
      setStatus('done');
      setForm(emptyForm);
    } catch {
      setStatus('error');
    }
  }

  return (
    <>
      <Hero
        titulo="Fale com a gente."
        subtitulo="Conte sobre o seu catálogo, seus canais de venda ou o seu blog. Respondemos com o caminho mais curto para o Alfred trabalhar na sua loja."
        primario={{ label: 'Começar grátis', to: linkCadastro() }}
      />

      <Section colado>
        <div className="max-w-xl ag-glass-strong ag-sheen rounded-[28px] p-6 sm:p-8">
          {status === 'done' ? (
            <div className="text-center py-6">
              <h2 className="font-display text-[26px] font-semibold mb-2 text-[var(--ag-text)]">Mensagem enviada.</h2>
              <p className="text-[var(--ag-text-2)]">Vamos responder no e-mail que você informou.</p>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-5">
              <div>
                <label htmlFor="nome" className="block font-semibold text-[14px] mb-1.5 text-[var(--ag-text)]">
                  Nome
                </label>
                <input
                  id="nome"
                  type="text"
                  required
                  value={form.nome}
                  onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
                  className="w-full rounded-[14px] px-4 py-3 text-[16px] text-[var(--ag-text)] bg-[var(--ag-surface-solid)] border border-[var(--ag-hairline-2)] focus:outline-none focus:ring-2 focus:ring-[var(--ag-accent)]"
                  placeholder="Seu nome"
                />
              </div>
              <div>
                <label htmlFor="email" className="block font-semibold text-[14px] mb-1.5 text-[var(--ag-text)]">
                  E-mail
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  className="w-full rounded-[14px] px-4 py-3 text-[16px] text-[var(--ag-text)] bg-[var(--ag-surface-solid)] border border-[var(--ag-hairline-2)] focus:outline-none focus:ring-2 focus:ring-[var(--ag-accent)]"
                  placeholder="voce@empresa.com"
                />
              </div>
              <div>
                <label htmlFor="mensagem" className="block font-semibold text-[14px] mb-1.5 text-[var(--ag-text)]">
                  Mensagem
                </label>
                <textarea
                  id="mensagem"
                  required
                  rows={5}
                  value={form.mensagem}
                  onChange={(e) => setForm((f) => ({ ...f, mensagem: e.target.value }))}
                  className="w-full rounded-[14px] px-4 py-3 text-[16px] text-[var(--ag-text)] bg-[var(--ag-surface-solid)] border border-[var(--ag-hairline-2)] focus:outline-none focus:ring-2 focus:ring-[var(--ag-accent)] resize-none"
                  placeholder="Conte um pouco sobre o seu catálogo ou operação de conteúdo."
                />
              </div>

              {status === 'error' && (
                <p className="text-sm text-[var(--ag-danger)]">
                  A mensagem não foi enviada. Confira a conexão e envie de novo.
                </p>
              )}

              <button
                type="submit"
                disabled={status === 'sending'}
                className="w-full min-h-[52px] px-6 rounded-full font-semibold text-white hover:brightness-[1.06] transition disabled:opacity-60" style={{ background: 'var(--ag-accent)' }}
              >
                {status === 'sending' ? 'Enviando…' : 'Enviar mensagem'}
              </button>
            </form>
          )}
        </div>
      </Section>
    </>
  );
}
