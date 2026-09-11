// Missão Produto: link → produto revisado → descrição gerada → antes/depois.
//
// Caso principal é a conta vazia: a etapa de contexto pede o link de um
// produto e usa a mesma extração, o mesmo formulário e a mesma conversão do
// ProductUrlImportModal — foto, título e categoria continuam obrigatórios, e
// um scrape ruim cai no preenchimento manual em vez de virar erro sem saída.
//
// A chegada salva no catálogo. Publicar direto no ERP fica para o Plano 2:
// até lá o botão não promete o que não faz.

import React, { useMemo, useState } from 'react';
import MissionRunner from './MissionRunner';
import type { Acao, Turno } from './MissionChat';
import type { StageLogLine, StageProps } from './Stage';
import { MISSOES, avancar, produtosSemDescricao, progresso } from './missionSteps';
import type { MissionState } from './missionTypes';
import PedidoWhatsApp from './PedidoWhatsApp';
import type { Category, Product } from '../../../types/models';
import { scrapeProductUrl } from '../../../services/productImportService';
import { uploadProductImage } from '../../../services/uploadService';
import { buildProduct, matchExistingCategory } from '../../../components/onboarding/buildProduct';
import ProductFormFields, { isProductFormValid, type ProductFormValue } from '../../../components/onboarding/ProductFormFields';
import {
  trackMissionArtifactPublished, trackMissionCompleted, trackMissionStepCompleted,
} from '../../../analytics';

interface Props {
  state: MissionState;
  onState: (s: MissionState) => void;
  produtos: Product[];
  categorias: Category[];
  /** handleProductCreatedFromOnboarding */
  onProdutoCriado: (p: Product) => void;
  /** handleCreateCategoryForOnboarding */
  onCriarCategoria: (name: string) => Promise<string | null>;
  /** handleGenerateDescriptionForOnboarding */
  onGerarDescricao: (id: string) => Promise<void>;
  /** saveToCloud(true) — persiste o catálogo já com o produto novo */
  onSalvarNoCatalogo: () => Promise<void>;
  onConcluir: () => void;
  /** publicarProdutoNoTiny do App — só chamado quando o produto tem _tinyProductId */
  onPublicarNoTiny: (id: string) => Promise<void>;
  /** true quando a conta ainda não deixou contato (onboarding não concluído) */
  mostrarPedidoWhatsapp: boolean;
  onEnviarWhatsapp: (whatsapp: string) => Promise<void>;
}

const formVazio: ProductFormValue = { title: '', categoryId: '', imageUrl: '', price: '', description: '' };

const semHtml = (v: unknown) => String(v ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function hostDe(url: string): string {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname;
  } catch {
    return url;
  }
}

const MissaoProduto: React.FC<Props> = ({
  state, onState, produtos, categorias,
  onProdutoCriado, onCriarCategoria, onGerarDescricao, onSalvarNoCatalogo, onConcluir,
  onPublicarNoTiny, mostrarPedidoWhatsapp, onEnviarWhatsapp,
}) => {
  const [url, setUrl] = useState('');
  const candidatos = useMemo(() => produtosSemDescricao(produtos), [produtos]);
  const [fase, setFase] = useState<'catalogo' | 'link' | 'revisao'>(() =>
    produtosSemDescricao(produtos).length > 0 ? 'catalogo' : 'link');
  // Capturado na montagem: depois do envio o App passa false, mas o cartão
  // precisa continuar na tela para mostrar o "Anotado".
  const [pedirWhatsapp] = useState(mostrarPedidoWhatsapp);
  const [form, setForm] = useState<ProductFormValue>(formVazio);
  const [categoriaSugerida, setCategoriaSugerida] = useState<string | undefined>();
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [log, setLog] = useState<StageLogLine[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  const passo = {
    ...progresso(state),
    titulo: MISSOES.produto.steps.find((s) => s.id === state.step)!.titulo,
  };
  const produto = useMemo(
    () => produtos.find((p) => p._id === state.dados.produtoId) ?? null,
    [produtos, state.dados.produtoId],
  );

  // Avança um passo, registrando a conclusão do anterior.
  const avancarPasso = (dados: Record<string, unknown>) => {
    trackMissionStepCompleted({ missionId: 'produto', step: state.step });
    onState(avancar({ ...state, dados: { ...state.dados, ...dados } }));
  };

  const lerLink = async () => {
    setErro(null);
    setOcupado(true);
    setLog([{ estado: 'agora', texto: 'abrindo a página…' }]);
    try {
      const r = await scrapeProductUrl(url.trim());
      if (r.source === 'failed') {
        // Mesmo comportamento do modal: não é beco sem saída, vira manual.
        setForm({ ...formVazio, imageUrl: r.product.imageUrl ?? '' });
        setCategoriaSugerida(undefined);
        setLog([{ estado: 'feito', texto: 'a página não trouxe dados de produto', destaque: hostDe(url) }]);
        setErro('Não consegui ler os dados dessa página. Preenche aqui — foto, título e categoria são obrigatórios.');
        setFase('revisao');
        return;
      }
      const casada = matchExistingCategory(r.product.category, categorias);
      setCategoriaSugerida(
        !casada && r.product.category?.length ? r.product.category[r.product.category.length - 1] : undefined,
      );
      setForm({
        title: r.product.title ?? '',
        categoryId: casada?.id ?? '',
        imageUrl: r.product.imageUrl ?? '',
        price: r.product.price != null ? String(r.product.price) : '',
        description: r.product.description ?? '',
      });
      setLog([
        { estado: 'feito', texto: 'página lida', destaque: hostDe(url) },
        { estado: 'feito', texto: r.source === 'structured' ? 'dados estruturados — título, preço, foto' : 'dados extraídos da página' },
      ]);
      setFase('revisao');
    } catch (e) {
      setForm(formVazio);
      setErro(e instanceof Error ? `${e.message} Quer preencher na mão?` : 'Não consegui abrir essa página. Quer preencher na mão?');
      setFase('revisao');
    } finally {
      setOcupado(false);
    }
  };

  const enviarFoto = async (file: File) => {
    setEnviandoFoto(true);
    try {
      const enviada = await uploadProductImage(file);
      setForm((f) => ({ ...f, imageUrl: enviada }));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao enviar a foto.');
    } finally {
      setEnviandoFoto(false);
    }
  };

  const criarProduto = () => {
    const criado = buildProduct(form, categorias);
    onProdutoCriado(criado);
    avancarPasso({
      produtoId: criado._id,
      origem: url.trim() ? 'url' : 'manual',
      descricaoOriginal: semHtml(criado['Descrição complementar']),
    });
  };

  const gerarDescricao = async () => {
    if (!produto?._id) return;
    setErro(null);
    setOcupado(true);
    setLog([
      { estado: 'feito', texto: 'produto no catálogo', destaque: String(produto['Descrição'] ?? '') },
      { estado: 'agora', texto: 'escrevendo a descrição…' },
    ]);
    try {
      await onGerarDescricao(produto._id);
      setLog((l) => [...l.slice(0, -1), { estado: 'feito', texto: 'descrição escrita' }]);
      avancarPasso({ descricaoGerada: true });
    } catch (e) {
      setLog((l) => l.slice(0, -1));
      setErro(e instanceof Error ? e.message : 'Não deu pra gerar a descrição agora.');
    } finally {
      setOcupado(false);
    }
  };

  const temTiny = !!produto?._tinyProductId;

  const finalizar = async (modo: 'tiny' | 'catalogo' | 'depois') => {
    if (!produto?._id) return;
    setErro(null);
    setOcupado(true);
    try {
      if (modo !== 'depois') await onSalvarNoCatalogo();
      if (modo === 'tiny') await onPublicarNoTiny(produto._id);
      if (modo !== 'depois') trackMissionArtifactPublished({ missionId: 'produto', destino: modo });
      trackMissionStepCompleted({ missionId: 'produto', step: 'chegada' });
      trackMissionCompleted({ missionId: 'produto' });
      onState({
        ...state,
        dados: {
          ...state.dados,
          ...(modo === 'tiny' ? { publicado: true } : {}),
          ...(modo !== 'depois' ? { salvoNoCatalogo: true } : {}),
        },
        artefato: { tipo: 'produto', id: produto._id, rotulo: String(produto['Descrição'] ?? 'Produto') },
        concluidaEm: new Date().toISOString(),
      });
      onConcluir();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui salvar agora. Tenta de novo.');
    } finally {
      setOcupado(false);
    }
  };

  const turnos: Turno[] = [];
  const acoes: Acao[] = [];
  let palco: StageProps | undefined;

  if (state.step === 'contexto' && fase === 'catalogo') {
    turnos.push({
      autor: 'agente',
      texto: `Você tem ${produtos.length} produtos, ${produtosSemDescricao(produtos, Infinity).length} sem descrição nenhuma. Escolhe um pra começar:`,
    });
    turnos.push({
      autor: 'agente',
      texto: (
        <div className="flex flex-col gap-1.5">
          {candidatos.map((p) => (
            <button
              key={p._id}
              type="button"
              onClick={() => avancarPasso({ produtoId: p._id, origem: 'catalogo', descricaoOriginal: semHtml(p['Descrição complementar']) })}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-xs hover:border-[#FF5B03]"
            >
              {String(p['Descrição'] ?? p['Código (SKU)'] ?? 'Produto sem nome')}
            </button>
          ))}
        </div>
      ),
    });
    acoes.push({ rotulo: 'Colar um link em vez disso', variante: 'secundaria', onClick: () => setFase('link') });
  }

  if (state.step === 'contexto' && fase === 'link') {
    turnos.push({
      autor: 'agente',
      texto: 'Me manda o link de um produto seu — pode ser do seu site ou de um anúncio. Eu leio a página e trago título, foto e preço.',
    });
    turnos.push({
      autor: 'agente',
      texto: (
        <input
          id="missao-produto-url"
          type="url"
          inputMode="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="cole o link aqui"
          className="w-full rounded-lg border border-slate-200 bg-[#f7f9fb] px-3 py-2 font-mono text-xs"
        />
      ),
    });
    if (log.length) palco = { titulo: 'Agente de Produto trabalhando', linhas: log };
    acoes.push({ rotulo: ocupado ? 'Lendo a página…' : 'Ler esse produto', onClick: lerLink, desabilitada: ocupado || !url.trim() });
    acoes.push({
      rotulo: 'Prefiro cadastrar na mão',
      variante: 'secundaria',
      desabilitada: ocupado,
      onClick: () => { setForm(formVazio); setCategoriaSugerida(undefined); setErro(null); setFase('revisao'); },
    });
  }

  if (state.step === 'contexto' && fase === 'revisao') {
    turnos.push({
      autor: 'agente',
      texto: erro ?? 'Confere o que eu trouxe. Foto, título e categoria são obrigatórios — o resto eu completo.',
    });
    turnos.push({
      autor: 'agente',
      texto: (
        <ProductFormFields
          value={form}
          onChange={setForm}
          categories={categorias}
          onUploadImage={enviarFoto}
          isUploadingImage={enviandoFoto}
          onCreateCategory={onCriarCategoria}
          suggestedCategoryName={categoriaSugerida}
        />
      ),
    });
    if (log.length) palco = { titulo: 'Agente de Produto trabalhando', linhas: log };
    acoes.push({ rotulo: 'Criar produto', onClick: criarProduto, desabilitada: !isProductFormValid(form) || enviandoFoto });
    acoes.push({ rotulo: 'Voltar ao link', variante: 'secundaria', onClick: () => { setErro(null); setFase('link'); } });
  }

  if (state.step === 'palco') {
    turnos.push({
      autor: 'agente',
      texto: (
        <>Vou escrever a descrição de <b>{String(produto?.['Descrição'] ?? 'seu produto')}</b>. Usa créditos da sua conta.</>
      ),
    });
    if (erro) turnos.push({ autor: 'agente', texto: erro });
    palco = {
      titulo: 'Agente de Produto trabalhando',
      linhas: log.length ? log : [{ estado: 'feito', texto: 'produto no catálogo', destaque: String(produto?.['Descrição'] ?? '') }],
      children: pedirWhatsapp ? <PedidoWhatsApp onEnviar={onEnviarWhatsapp} /> : undefined,
    };
    acoes.push({ rotulo: ocupado ? 'Escrevendo…' : 'Gerar a descrição', onClick: gerarDescricao, desabilitada: ocupado || !produto });
  }

  if (state.step === 'chegada') {
    const antes = String(state.dados.descricaoOriginal ?? '');
    const depois = semHtml(produto?.['Descrição complementar']);
    turnos.push({ autor: 'agente', texto: 'Pronto. Olha o antes e o depois:' });
    if (erro) turnos.push({ autor: 'agente', texto: erro });
    palco = {
      titulo: 'Resultado',
      linhas: [{ estado: 'feito', texto: 'descrição escrita', destaque: String(produto?.['Descrição'] ?? '') }],
      children: (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
            <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider">Antes</span>
            {antes ? `${antes.slice(0, 220)}${antes.length > 220 ? '…' : ''}` : '— sem descrição —'}
          </div>
          <div className="rounded-xl border-2 border-[#FF5B03] bg-white p-3 text-xs">
            <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-[#FF5B03]">Depois</span>
            {depois ? `${depois.slice(0, 280)}${depois.length > 280 ? '…' : ''}` : '—'}
          </div>
        </div>
      ),
    };
    acoes.push({
      rotulo: ocupado ? 'Salvando…' : temTiny ? 'Publicar no Tiny' : 'Salvar no meu catálogo',
      onClick: () => finalizar(temTiny ? 'tiny' : 'catalogo'),
      desabilitada: ocupado,
    });
    acoes.push({ rotulo: 'Quero ajustar antes', variante: 'secundaria', onClick: () => finalizar('depois'), desabilitada: ocupado });
  }

  return (
    <MissionRunner titulo="Seu primeiro produto aprimorado" passo={passo} turnos={turnos} palco={palco} acoes={acoes} />
  );
};

export default MissaoProduto;
