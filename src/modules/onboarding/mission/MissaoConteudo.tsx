// Missão Conteúdo: site → configuração revisada → clusters → artigo → blog em
// preview (noindex) → "Publicar o blog".
//
// O palco é retomável (conteudoFluxo.ts). O listener do artigo é a fonte da
// verdade do pipeline: a resposta HTTP de produceArticle pode cair numa espera
// longa sem que o pipeline pare, e os erros dele (créditos inclusive) aparecem
// como status 'erro' no próprio artigo.

import React, { useEffect, useRef, useState } from 'react';
import MissionRunner from './MissionRunner';
import type { Acao, Turno } from './MissionChat';
import type { StageLogLine, StageProps } from './Stage';
import PedidoWhatsApp from './PedidoWhatsApp';
import { MISSOES, avancar, progresso } from './missionSteps';
import type { MissionState } from './missionTypes';
import { proximaAcaoConteudo, rotuloEstagio, slugCandidatos, type AcaoConteudo, type DadosConteudo } from './conteudoFluxo';
import {
  approveCluster, createArticleManual, createProject, generateClusters, getClusters, listenCalendar,
  produceArticle, publishArticle, scanWebsite,
} from '../../../services/contentService';
import { claimBlogSlug, saveBlogSettings } from '../../../services/blogService';
import { DEFAULT_BLOG_COLORS } from '../../content/blog/types';
import type { CalendarArticle, ContentProjectConfig } from '../../content/types';
import { trackMissionArtifactPublished, trackMissionCompleted, trackMissionStepCompleted } from '../../../analytics';

interface Props {
  uid: string;
  state: MissionState;
  onState: (s: MissionState) => void;
  /** Soma estimada dos créditos do caminho enxuto (clusters + pesquisa + artigo + capa). */
  custoCreditos: number;
  mostrarPedidoWhatsapp: boolean;
  onEnviarWhatsapp: (whatsapp: string) => Promise<void>;
  /** Liga modules.contentAgent e modules.blog para esta conta. */
  onHabilitarConteudo: () => Promise<void>;
  onComprarCreditos: () => void;
  onConcluir: () => void;
}

interface Rascunho { nome: string; oQueVende: string; publico: string; tom: string; descricao: string; objetivos: string[]; palavrasChave: string[] }
const rascunhoVazio: Rascunho = { nome: '', oQueVende: '', publico: '', tom: '', descricao: '', objetivos: [], palavrasChave: [] };

const mensagem = (e: unknown, padrao: string) => (e instanceof Error && e.message ? e.message : padrao);
const pareceCredito = (m: string | null) => !!m && /cr[ée]dito/i.test(m);

const MissaoConteudo: React.FC<Props> = ({
  uid, state, onState, custoCreditos, mostrarPedidoWhatsapp, onEnviarWhatsapp,
  onHabilitarConteudo, onComprarCreditos, onConcluir,
}) => {
  const d = state.dados as DadosConteudo;
  const [site, setSite] = useState('');
  const [fase, setFase] = useState<'site' | 'revisao'>('site');
  const [rascunho, setRascunho] = useState<Rascunho>(rascunhoVazio);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [artigo, setArtigo] = useState<CalendarArticle | null>(null);
  const [tick, setTick] = useState(0);
  // Bumpa a cada 30s enquanto esperamos o servidor, só para recalcular
  // paradoHaMin (produção travada, sem novidade nenhuma do listener).
  const [agora, setAgora] = useState(() => Date.now());
  const [pedirWhatsapp] = useState(mostrarPedidoWhatsapp);
  const executando = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const artigoRef = useRef(artigo);
  artigoRef.current = artigo;

  const passo = { ...progresso(state), titulo: MISSOES.conteudo.steps.find((s) => s.id === state.step)!.titulo };

  // Grava no estado da missão a partir do valor mais recente (não do render).
  const gravar = (patch: DadosConteudo) => {
    const s = stateRef.current;
    const novo = { ...s, dados: { ...s.dados, ...patch } };
    stateRef.current = novo;
    onState(novo);
  };
  const avancarPasso = (patch: DadosConteudo) => {
    const s = stateRef.current;
    trackMissionStepCompleted({ missionId: 'conteudo', step: s.step });
    const novo = avancar({ ...s, dados: { ...s.dados, ...patch } });
    stateRef.current = novo;
    onState(novo);
  };

  useEffect(() => {
    if (!d.projectId || !d.articleId) return;
    return listenCalendar(uid, d.projectId, (lista) => setArtigo(lista.find((a) => a.id === d.articleId) ?? null));
  }, [uid, d.projectId, d.articleId]);

  // ---- contexto -----------------------------------------------------------
  const lerSite = async () => {
    setErro(null);
    setOcupado(true);
    try {
      const { config } = await scanWebsite(site.trim());
      setRascunho({
        nome: config.nomeEmpresa ?? '',
        oQueVende: config.produtoServico ?? '',
        publico: (config.publicoAlvo ?? []).join(', '),
        tom: config.tomDeVoz ?? '',
        descricao: config.descricao ?? '',
        objetivos: config.objetivos ?? [],
        palavrasChave: config.palavrasChave ?? [],
      });
    } catch (e) {
      setRascunho(rascunhoVazio);
      setErro(`${mensagem(e, 'Não consegui ler o site.')} Me conta aqui mesmo:`);
    } finally {
      setOcupado(false);
      setFase('revisao');
    }
  };

  const confirmar = async () => {
    setErro(null);
    setOcupado(true);
    try {
      const config: ContentProjectConfig = {
        nomeEmpresa: rascunho.nome.trim(),
        descricao: (rascunho.descricao || rascunho.oQueVende).trim(),
        produtoServico: rascunho.oQueVende.trim(),
        publicoAlvo: rascunho.publico.split(',').map((x) => x.trim()).filter(Boolean),
        tomDeVoz: rascunho.tom.trim() || 'Amigável',
        objetivos: rascunho.objetivos.length ? rascunho.objetivos : ['Atrair visitantes do Google'],
        palavrasChave: rascunho.palavrasChave,
        referencias: [],
        frequenciaPostagens: '2 vezes na semana',
        wordpressUrl: '',
        wordpressUser: '',
        sanityProjectId: '',
        sanityDataset: 'production',
        estiloImagem: 'Realista',
        siteUrl: site.trim(),
      };
      const projectId = await createProject(uid, config);
      await onHabilitarConteudo();
      avancarPasso({ projectId, configConfirmada: true, nomeEmpresa: config.nomeEmpresa, descricao: config.descricao });
    } catch (e) {
      setErro(mensagem(e, 'Não consegui criar o projeto.'));
    } finally {
      setOcupado(false);
    }
  };

  // ---- palco: um sub-passo por vez, sempre a partir do estado gravado -------
  const executar = async (acao: AcaoConteudo) => {
    const dd = stateRef.current.dados as DadosConteudo;
    const projectId = dd.projectId!;
    if (acao === 'gerar-clusters') {
      // Recarregar no meio da geração não deve cobrar de novo: se o servidor
      // já gravou clusters deste projeto (de uma corrida anterior), usa esses.
      const existentes = await getClusters(uid, projectId);
      const jaAtivos = existentes.filter((c) => !c.excluido);
      const ativos = jaAtivos.length ? jaAtivos : (await generateClusters(projectId)).clusters.filter((c) => !c.excluido);
      if (!ativos.length) throw new Error('Não encontrei temas para o seu blog. Tenta revisar o que você vende.');
      const volume = (c: (typeof ativos)[number]) => c.palavrasChave.reduce((t, k) => t + (k.volume ?? 0), 0);
      const tema = [...ativos].sort((a, b) => volume(b) - volume(a))[0];
      const kw = [...tema.palavrasChave].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))[0]?.termo ?? tema.nome;
      await approveCluster(uid, projectId, tema.id, true);
      gravar({ clusterId: tema.id, tema: tema.nome, kwPrincipal: kw, nClusters: ativos.length });
      return;
    }
    if (acao === 'criar-artigo') {
      const kw = dd.kwPrincipal ?? dd.tema ?? '';
      const articleId = await createArticleManual(uid, projectId, {
        titulo: kw.charAt(0).toUpperCase() + kw.slice(1),
        kwPrincipal: kw,
        tamanho: 'curto',
        scheduledDate: new Date().toISOString().slice(0, 10),
        clusterId: dd.clusterId ?? '',
        produtosVinculados: [],
        priority: 0,
      });
      gravar({ articleId });
      return;
    }
    if (acao === 'criar-blog') {
      let ultimoErro: unknown = null;
      for (const candidato of slugCandidatos(dd.nomeEmpresa ?? '')) {
        try {
          const { slug } = await claimBlogSlug(projectId, candidato);
          await saveBlogSettings(uid, projectId, {
            enabled: true,
            indexable: false,
            slug,
            title: dd.nomeEmpresa ?? 'Meu blog',
            description: dd.descricao ?? '',
            template: 'editorial',
            colors: DEFAULT_BLOG_COLORS,
            customDomains: [],
            createdAt: new Date().toISOString(),
          });
          gravar({ blogSlug: slug });
          return;
        } catch (e) {
          ultimoErro = e; // 409: endereço em uso — tenta o próximo
        }
      }
      throw ultimoErro ?? new Error('Não consegui reservar um endereço para o blog.');
    }
    if (acao === 'produzir') {
      gravar({ producaoIniciada: true });
      try {
        await produceArticle(projectId, dd.articleId!);
      } catch (e) {
        // O servidor recusa uma corrida concorrente/duplicada com essa
        // mensagem quando já há uma produção recente em andamento — não é
        // uma falha, é a proteção contra cobrar duas vezes. Mantém
        // producaoIniciada e deixa o listener mostrar o desfecho.
        if (e instanceof Error && e.message === 'Este artigo já está em produção') return;
        // Se o servidor nem começou (o artigo segue agendado), devolve o erro e
        // libera o "tentar de novo". Se começou, o listener mostra o desfecho.
        if ((artigoRef.current?.status ?? 'agendado') === 'agendado') {
          gravar({ producaoIniciada: false });
          throw e;
        }
      }
      return;
    }
    if (acao === 'publicar') {
      const { url } = await publishArticle(projectId, dd.articleId!, 'blog');
      gravar({ urlPost: url });
      return;
    }
    if (acao === 'pronto') {
      avancarPasso({});
    }
  };

  const paradoHaMin = artigo ? Math.floor((agora - new Date(artigo.updatedAt).getTime()) / 60000) : undefined;
  const resumo = artigo ? { status: artigo.status, stage: artigo.stage, temFinal: !!artigo.articleFinal, paradoHaMin } : null;
  const acao = state.step === 'palco' ? proximaAcaoConteudo(d, resumo) : null;

  useEffect(() => {
    if (!acao || acao === 'aguardar' || acao === 'erro' || acao === 'travado' || erro || executando.current) return;
    executando.current = true;
    executar(acao)
      .catch((e) => setErro(mensagem(e, 'Algo falhou no meio do caminho.')))
      .finally(() => {
        executando.current = false;
        setTick((t) => t + 1); // reavalia: o próximo passo pode depender só do que acabou de ser gravado
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acao, erro, tick]);

  // Enquanto esperamos (ou já detectamos que travou), recalcula paradoHaMin
  // periodicamente — sem isso, um servidor morto nunca é detectado, porque
  // nada mais dispara um novo render.
  useEffect(() => {
    if (acao !== 'aguardar' && acao !== 'travado') return;
    const id = setInterval(() => setAgora(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [acao]);

  const tentarDeNovo = () => {
    if (artigo?.status === 'erro' || acao === 'travado') gravar({ producaoIniciada: false });
    setErro(null);
  };

  // ---- render ---------------------------------------------------------------
  const turnos: Turno[] = [];
  const acoes: Acao[] = [];
  let palco: StageProps | undefined;
  const campo = (id: string, rotulo: string, valor: string, onChange: (v: string) => void, dica?: string) => (
    <label htmlFor={id} className="flex flex-col gap-1 text-[11px] font-semibold text-slate-500">
      {rotulo}
      <input
        id={id}
        value={valor}
        placeholder={dica}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-200 bg-[#f7f9fb] px-3 py-2 text-xs font-normal text-slate-800"
      />
    </label>
  );

  if (state.step === 'contexto' && fase === 'site') {
    turnos.push({ autor: 'agente', texto: 'Me passa o endereço do seu site ou loja. Eu leio a página e monto a estratégia do blog pra você só revisar.' });
    turnos.push({
      autor: 'agente',
      texto: (
        <>
          <label htmlFor="missao-conteudo-site" className="sr-only">Endereço do seu site</label>
          <input
            id="missao-conteudo-site"
            type="url"
            inputMode="url"
            value={site}
            onChange={(e) => setSite(e.target.value)}
            placeholder="suamarca.com.br"
            className="w-full rounded-lg border border-slate-200 bg-[#f7f9fb] px-3 py-2 font-mono text-xs"
          />
        </>
      ),
    });
    acoes.push({ rotulo: ocupado ? 'Lendo o site…' : 'Ler meu site', onClick: lerSite, desabilitada: ocupado || !site.trim() });
    acoes.push({ rotulo: 'Ainda não tenho site', variante: 'secundaria', onClick: () => { setRascunho(rascunhoVazio); setFase('revisao'); } });
  }

  if (state.step === 'contexto' && fase === 'revisao') {
    turnos.push({ autor: 'agente', texto: erro ?? 'Montei isso — confere o que não bater:' });
    turnos.push({
      autor: 'agente',
      texto: (
        <div className="flex flex-col gap-2">
          {campo('conteudo-nome', 'Nome da marca', rascunho.nome, (v) => setRascunho((r) => ({ ...r, nome: v })))}
          {campo('conteudo-vende', 'O que você vende', rascunho.oQueVende, (v) => setRascunho((r) => ({ ...r, oQueVende: v })), 'ex.: utilidades domésticas')}
          {campo('conteudo-publico', 'Para quem (separe por vírgula)', rascunho.publico, (v) => setRascunho((r) => ({ ...r, publico: v })))}
          {campo('conteudo-tom', 'Tom de voz', rascunho.tom, (v) => setRascunho((r) => ({ ...r, tom: v })), 'ex.: prático e acolhedor')}
        </div>
      ),
    });
    acoes.push({
      rotulo: ocupado ? 'Criando…' : 'Está certo',
      onClick: confirmar,
      desabilitada: ocupado || !rascunho.nome.trim() || !rascunho.oQueVende.trim(),
    });
    acoes.push({ rotulo: 'Voltar', variante: 'secundaria', onClick: () => { setErro(null); setFase('site'); } });
  }

  if (state.step === 'palco') {
    const linhas: StageLogLine[] = [{ estado: 'feito', texto: 'marca e público confirmados', destaque: d.nomeEmpresa }];
    if (d.clusterId) linhas.push({ estado: 'feito', texto: `temas encontrados — escolhi "${d.tema}"`, destaque: String(d.nClusters ?? '') });
    if (d.blogSlug) linhas.push({ estado: 'feito', texto: 'blog criado', destaque: `/b/${d.blogSlug}/` });
    const stage = artigo?.stage ?? 0;
    for (let i = 1; i < stage; i++) linhas.push({ estado: 'feito', texto: rotuloEstagio(i) });
    if (acao === 'gerar-clusters') linhas.push({ estado: 'agora', texto: 'pesquisando temas e palavras-chave…' });
    else if (artigo?.status === 'em_producao') linhas.push({ estado: 'agora', texto: `${rotuloEstagio(stage) || 'escrevendo'}…` });
    else if (acao === 'publicar') linhas.push({ estado: 'agora', texto: 'publicando no blog…' });
    else if (!erro && acao !== 'erro' && acao !== 'travado') linhas.push({ estado: 'agora', texto: 'preparando o artigo…' });

    turnos.push({
      autor: 'agente',
      texto: d.kwPrincipal
        ? <>Vou escrever sobre <b>{d.kwPrincipal}</b> — é o que mais buscam no seu tema. Usa cerca de {custoCreditos} créditos.</>
        : <>Procurando os temas que o seu público mais busca. O caminho todo usa cerca de {custoCreditos} créditos.</>,
    });
    const textoLastError = artigo?.lastError === 'INSUFFICIENT_CREDITS'
      ? 'Créditos insuficientes para terminar o artigo.'
      : (artigo?.lastError ?? 'O artigo falhou no meio da produção.');
    const falha = erro
      ?? (acao === 'erro' ? textoLastError : acao === 'travado' ? 'A produção parou de responder.' : null);
    if (falha) {
      turnos.push({ autor: 'agente', texto: falha });
      acoes.push({ rotulo: 'Tentar de novo', onClick: tentarDeNovo });
      if (pareceCredito(falha)) acoes.push({ rotulo: 'Comprar créditos', variante: 'secundaria', onClick: onComprarCreditos });
    }
    palco = {
      titulo: 'Agente de Conteúdo trabalhando',
      linhas,
      children: pedirWhatsapp ? <PedidoWhatsApp onEnviar={onEnviarWhatsapp} /> : undefined,
    };
  }

  if (state.step === 'chegada') {
    const blogUrl = `${window.location.origin}/b/${d.blogSlug}/`;
    turnos.push({ autor: 'agente', texto: <>Seu blog está montado. <b>Abre aí</b> — ele ainda não aparece no Google até você publicar.</> });
    if (erro) turnos.push({ autor: 'agente', texto: erro });
    palco = {
      titulo: 'Resultado',
      linhas: [{ estado: 'feito', texto: 'primeiro artigo no ar, fora do Google', destaque: `/b/${d.blogSlug}/` }],
      children: (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3">
          <span className="truncate font-mono text-[11px] text-slate-600">{blogUrl}</span>
          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-500">noindex</span>
        </div>
      ),
    };
    const concluir = (publicado: boolean) => {
      trackMissionStepCompleted({ missionId: 'conteudo', step: 'chegada' });
      trackMissionCompleted({ missionId: 'conteudo' });
      const s = stateRef.current;
      onState({
        ...s,
        dados: { ...s.dados, ...(publicado ? { blogPublicado: true } : {}) },
        artefato: { tipo: 'blog', id: String(d.projectId), rotulo: String(d.nomeEmpresa ?? 'Blog'), url: blogUrl },
        concluidaEm: new Date().toISOString(),
      });
      onConcluir();
    };
    acoes.push({
      rotulo: 'Abrir meu blog',
      variante: 'secundaria',
      onClick: () => { window.open(blogUrl, '_blank', 'noopener'); gravar({ previewAberto: true }); },
    });
    acoes.push({
      rotulo: ocupado ? 'Publicando…' : 'Publicar o blog',
      desabilitada: ocupado,
      onClick: async () => {
        setErro(null);
        setOcupado(true);
        try {
          await saveBlogSettings(uid, String(d.projectId), { indexable: true });
          trackMissionArtifactPublished({ missionId: 'conteudo', destino: 'blog' });
          concluir(true);
        } catch (e) {
          setErro(mensagem(e, 'Não consegui publicar agora.'));
        } finally {
          setOcupado(false);
        }
      },
    });
    acoes.push({ rotulo: 'Publico depois', variante: 'secundaria', onClick: () => concluir(false) });
  }

  return <MissionRunner titulo="Seu blog no ar" passo={passo} turnos={turnos} palco={palco} acoes={acoes} />;
};

export default MissaoConteudo;
