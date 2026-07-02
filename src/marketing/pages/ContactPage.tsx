import { FormEvent, useState } from 'react';
import Hero from '../components/Hero';
import Section from '../components/Section';
import { saveLead, LeadInput } from '../leadService';
import { usePageMeta } from '../usePageMeta';

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
      setStatus('done');
      setForm(emptyForm);
    } catch {
      setStatus('error');
    }
  }

  return (
    <>
      <Hero
        theme="brand"
        eyebrow="Contato"
        titleLead="Fale com"
        titleAccent="um especialista"
        titleTail="do Alfreds."
        subtitle="Conte um pouco sobre o seu catálogo ou operação de conteúdo e retornamos com uma proposta sob medida."
        primaryCta={{ label: 'Começar grátis', to: '/entrar' }}
      />

      <Section tone="light">
        <div className="max-w-xl mx-auto">
          {status === 'done' ? (
            <div className="rounded-2xl border border-orange/30 bg-orange/10 p-8 text-center">
              <h2 className="font-display text-2xl font-extrabold mb-2">Mensagem enviada!</h2>
              <p className="text-ink/70">Recebemos seu contato — retornaremos em breve.</p>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-5">
              <div>
                <label htmlFor="nome" className="block font-bold text-sm mb-1.5">
                  Nome
                </label>
                <input
                  id="nome"
                  type="text"
                  required
                  value={form.nome}
                  onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
                  className="w-full rounded-xl border border-ink/20 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-orange"
                  placeholder="Seu nome"
                />
              </div>
              <div>
                <label htmlFor="email" className="block font-bold text-sm mb-1.5">
                  E-mail
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  className="w-full rounded-xl border border-ink/20 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-orange"
                  placeholder="voce@empresa.com"
                />
              </div>
              <div>
                <label htmlFor="mensagem" className="block font-bold text-sm mb-1.5">
                  Mensagem
                </label>
                <textarea
                  id="mensagem"
                  required
                  rows={5}
                  value={form.mensagem}
                  onChange={(e) => setForm((f) => ({ ...f, mensagem: e.target.value }))}
                  className="w-full rounded-xl border border-ink/20 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-orange resize-none"
                  placeholder="Conte um pouco sobre o seu catálogo ou operação de conteúdo."
                />
              </div>

              {status === 'error' && (
                <p className="text-sm text-red-600">
                  Não foi possível enviar sua mensagem agora. Tente novamente em instantes.
                </p>
              )}

              <button
                type="submit"
                disabled={status === 'sending'}
                className="w-full px-6 py-3.5 rounded-xl font-bold bg-orange text-white hover:brightness-95 transition disabled:opacity-60"
              >
                {status === 'sending' ? 'Enviando...' : 'Enviar mensagem'}
              </button>
            </form>
          )}
        </div>
      </Section>
    </>
  );
}
