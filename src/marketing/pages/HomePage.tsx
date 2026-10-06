import { Check, FileText, PenLine, ShoppingBag, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Objetivo } from '../../modules/agent/capacidades';
import { OBJETIVO_INFO } from '../../modules/onboarding/mission/objetivos';
import Hero from '../components/Hero';
import SemanaDemo from '../components/SemanaDemo';
import PlanoDemo from '../components/PlanoDemo';
import OperacoesDemo from '../components/OperacoesDemo';
import IntegrationsGrid from '../components/IntegrationsGrid';
import FAQ from '../components/FAQ';
import FinalCTA from '../components/FinalCTA';
import { Cabecalho, Cta, Section } from '../components/ui';
import { PAGINAS, homeFaq } from '../content';
import { linkCadastro } from '../objetivoSite';
import { usePageMeta } from '../usePageMeta';

const PORTAS: { objetivo: Objetivo; to: string; Icone: LucideIcon; promessa: string }[] = [
  { objetivo: 'produto', to: '/descricoes-de-produto', Icone: FileText, promessa: 'Descrição, SEO, atributos e fotos ambientadas para o catálogo inteiro, enviados ao seu ERP.' },
  { objetivo: 'meli', to: '/mercado-livre', Icone: ShoppingBag, promessa: 'Título, ficha técnica, fotos e vídeo de cada anúncio. Você aprova antes de publicar.' },
  { objetivo: 'conteudo', to: '/blog-com-ia', Icone: PenLine, promessa: 'Temas, calendário e artigos na voz da sua marca, publicados no seu blog.' },
];

const FRENTES: { nome: string; cor: string; to?: string; itens: string[] }[] = [
  {
    nome: 'Produto',
    cor: 'var(--ag-orig-produto)',
    to: '/descricoes-de-produto',
    itens: ['Descrição e SEO de cada produto', 'Atributos que a categoria pede', 'Fotos ambientadas', 'Vídeo do produto e vídeo com apresentador', 'Envio ao Tiny, Bling, IdWorks ou Wake'],
  },
  {
    nome: 'Mercado Livre',
    cor: 'var(--ag-orig-meli)',
    to: '/mercado-livre',
    itens: ['Nota de cada anúncio', 'Título que o comprador busca', 'Ficha técnica completa', 'Capa, fotos e vídeo do anúncio', 'Publicação só com o seu ok'],
  },
  {
    nome: 'Conteúdo',
    cor: 'var(--ag-orig-conteudo)',
    to: '/blog-com-ia',
    itens: ['Perfil e tom da sua marca', 'Mapa de temas para o Google', 'Calendário editorial', 'Artigos com link para produtos', 'Blog publicado no seu domínio'],
  },
  {
    nome: 'Operações',
    cor: 'var(--ag-orig-operacoes)',
    itens: ['Vendas do dia, da semana e do mês', 'Pedidos parados no funil', 'Estoque acabando ou esgotado', 'Preço abaixo do custo', 'Entregas fora do prazo'],
  },
];

const GARANTIAS = [
  'Antes e depois de cada item, um por vez ou em lote',
  'O custo em créditos aparece antes de você confirmar',
  'Um lote em massa pode ser desfeito com um clique',
  'Você decide o que pode rodar no automático',
];

export default function HomePage() {
  usePageMeta({
    title: 'Alfreds | O agente de IA que cuida da sua loja',
    description:
      'O Alfred escreve descrições, otimiza anúncios do Mercado Livre e mantém o seu blog no ar. Lê seu ERP, monta a semana da loja e só grava o que você aprovar. Comece com 10 créditos grátis.',
  });

  return (
    <>
      <Hero
        titulo={"Sua loja tem uma lista de tarefas. O\u00a0Alfred dá conta dela."}
        subtitulo="O Alfred é um agente de IA que lê seu catálogo, seu ERP e seus anúncios, monta a semana da loja e faz o trabalho: descrições, fotos, Mercado Livre e blog. Nada é gravado sem o seu ok."
        primario={{ label: 'Começar grátis', to: linkCadastro() }}
        secundario={{ label: 'Escolher por onde começar', to: '#objetivos' }}
        microcopy="10 créditos grátis para testar. Sem cartão."
        alinhar="topo"
        lado={
          <div>
            <SemanaDemo />
            <p className="mt-3 text-center text-[13px] text-[var(--ag-text-3)]">Experimente: aperte “Fazer com Alfred”.</p>
          </div>
        }
      />

      <Section id="objetivos">
        <Cabecalho
          titulo="Por onde você quer começar?"
          texto="É a primeira pergunta que o Alfred faz quando você entra. Escolha um caminho; os outros entram na sua semana depois."
        />
        <ul className="flex flex-col gap-3">
          {PORTAS.map(({ objetivo, to, Icone, promessa }) => {
            const p = PAGINAS[objetivo];
            return (
              <li key={objetivo} className="ag-glass ag-sheen rounded-[28px] p-5 sm:p-6 grid gap-5 md:grid-cols-[auto_1fr_auto] md:items-center">
                <span className="w-14 h-14 rounded-[18px] grid place-items-center" style={{ background: `color-mix(in srgb, ${p.cor} 16%, transparent)`, color: p.cor }}>
                  <Icone className="w-6 h-6" strokeWidth={1.75} />
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-[var(--ag-text-3)]">{OBJETIVO_INFO[objetivo].agente}</p>
                  <h3 className="mt-0.5 font-display text-[24px] md:text-[26px] font-semibold tracking-tight leading-tight text-[var(--ag-text)]">
                    {OBJETIVO_INFO[objetivo].titulo}
                  </h3>
                  <p className="mt-1.5 max-w-xl leading-relaxed text-[var(--ag-text-2)]">{promessa}</p>
                </div>
                <div className="flex flex-wrap gap-2 md:justify-end">
                  <Cta to={to} variante="vidro">Ver como funciona</Cta>
                  <Cta to={linkCadastro(objetivo)} variante="escuro" rotulo={`Começar por ${objetivo}`}>Começar por aqui</Cta>
                </div>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section>
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <Cabecalho
              className="!mb-8"
              titulo="Você aprova. O Alfred grava."
              texto="Você pede em português, como pediria a alguém da equipe. O Alfred lê o que precisa, monta um plano e espera a sua revisão antes de mexer em qualquer coisa."
            />
            <ul className="flex flex-col gap-3">
              {GARANTIAS.map((g) => (
                <li key={g} className="flex items-start gap-3 text-[16px] text-[var(--ag-text)]">
                  <span className="mt-0.5 w-6 h-6 rounded-full grid place-items-center shrink-0" style={{ background: 'var(--ag-ok-soft)', color: 'var(--ag-ok)' }}>
                    <Check className="w-3.5 h-3.5" />
                  </span>
                  {g}
                </li>
              ))}
            </ul>
          </div>
          <PlanoDemo />
        </div>
      </Section>

      <Section colado>
        <Cabecalho titulo="Um agente, quatro frentes da sua loja." texto="O mesmo Alfred, a mesma conversa e os mesmos créditos para tudo." />
        <div className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {FRENTES.map((f) => (
            <div key={f.nome}>
              <p className="flex items-center gap-2 pb-3 text-[17px] font-semibold text-[var(--ag-text)]" style={{ borderBottom: `2px solid ${f.cor}` }}>
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: f.cor }} />
                {f.nome}
              </p>
              <ul className="mt-4 flex flex-col gap-2.5">
                {f.itens.map((i) => (
                  <li key={i} className="text-[15px] leading-snug text-[var(--ag-text-2)]">{i}</li>
                ))}
              </ul>
              {f.to && (
                <Link to={f.to} className="mt-4 inline-block text-[14.5px] font-semibold text-[var(--ag-text)] underline decoration-[var(--ag-hairline-2)] underline-offset-4 hover:decoration-[var(--ag-text)]">
                  Saiba mais sobre {f.nome === 'Produto' ? 'descrições' : f.nome === 'Conteúdo' ? 'o blog' : 'o Mercado Livre'}
                </Link>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section tone="dark" id="operacoes">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <Cabecalho
              className="!mb-6"
              titulo="Pedido parado e estoque acabando aparecem antes de virar prejuízo."
              texto="O Centro de Operações junta vendas, pedidos, estoque e preços do seu ERP e da sua loja num painel só. O Alfred lê o mesmo painel e põe o que é urgente na sua semana."
            />
            <p className="text-[13px] text-[var(--ag-text-3)]">Ao lado, um exemplo com dados fictícios.</p>
          </div>
          <OperacoesDemo />
        </div>

        <div className="mt-24">
          <Cabecalho
            titulo="Conecta no que a sua loja já usa."
            texto="O Alfred lê e grava direto no ERP, na loja e no marketplace. No envio do catálogo vão só título, descrição, SEO e imagens: NCM, GTIN e medidas ficam como estão."
          />
          <IntegrationsGrid />
        </div>
      </Section>

      <Section>
        <div className="ag-glass-strong ag-sheen rounded-[30px] p-6 sm:p-10 grid gap-8 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <h2 className="font-display text-[30px] md:text-[38px] font-semibold leading-[1.08] tracking-[-0.03em] text-[var(--ag-text)]">
              Pague pelo trabalho feito, não por usuário.
            </h2>
            <p className="mt-3 max-w-xl text-[17px] leading-relaxed text-[var(--ag-text-2)]">
              Créditos a R$ 0,50, sem mensalidade e sem fidelidade. Toda ação mostra o custo antes de você confirmar.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Cta to="/precos" variante="vidro">Ver preços</Cta>
            <Cta to={linkCadastro()} rotulo="Começar grátis (preço)">Começar grátis</Cta>
          </div>
        </div>
      </Section>

      <Section colado>
        <Cabecalho titulo="Perguntas frequentes" centro />
        <FAQ items={homeFaq} />
      </Section>

      <Section colado>
        <FinalCTA
          title="Sua semana já tem tarefa. Deixe o Alfred começar."
          texto="Crie a conta, escolha por onde começar e veja o primeiro resultado em minutos."
          ctaLabel="Começar grátis"
          ctaTo={linkCadastro()}
        />
      </Section>
    </>
  );
}
