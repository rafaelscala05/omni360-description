// Verificação da lógica pura da "Sua semana" do Alfred (src/modules/agent/semana.ts).
// Não sobe servidor e não toca o Firestore. Rodar com: npx tsx scripts/verify-semana.mjs
import {
  diaNaSemana,
  inicioDaSemana,
  MAX_POR_DIA,
  montarSemana,
  proximoPasso,
  semImagem,
  PROMPT_DESCRICOES,
  PROMPT_MELI,
  PROMPT_ATRIBUTOS,
  PROMPT_AMBIENTADAS,
  PROMPT_BANNER,
  PROMPT_PEDIDOS_TINY,
  textoEstimativa,
  chaveDaSemana,
  semanaParaGuardar,
  mesmaSemana,
} from '../src/modules/agent/semana.ts';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? '  ok' : 'FALHA'}  ${label}${
      ok ? '' : ` → esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`
    }`,
  );
}

// Quarta, 30/09/2026, 15h local.
const QUARTA = new Date(2026, 8, 30, 15, 0);
const base = {
  hoje: QUARTA,
  produtosSemDescricao: 0,
  produtosSemImagem: 0,
  acoes: [],
  artigos: [],
  meliPropostasAguardando: null,
  integracoesComAlerta: [],
};
const acao = (over) => ({
  id: 'a1', threadId: 't', tool: 'wake.produto.preco', provider: 'wake', args: {},
  preview: { resumo: 'Preço atualizado', alvo: 'SKU-1', campos: [], avisos: [] },
  status: 'pending', createdAt: '2026-09-30T10:00:00.000Z', ...over,
});

// Semana começa na segunda à meia-noite local, inclusive quando hoje é domingo.
const ini = inicioDaSemana(QUARTA);
check('início da semana é segunda 28/09', [ini.getFullYear(), ini.getMonth(), ini.getDate(), ini.getHours()], [2026, 8, 28, 0]);
check('domingo pertence à semana que começou na segunda anterior', inicioDaSemana(new Date(2026, 9, 4, 23)).getDate(), 28);
check('quarta é o dia 2', diaNaSemana(ini, QUARTA), 2);
check('segunda seguinte fica fora', diaNaSemana(ini, new Date(2026, 9, 5)), null);

// Semana vazia não inventa tarefa.
check('sem sinais, sem tarefas', montarSemana(base), []);

// Produto não tem ferramenta no registry: leva à tela, não promete execução.
const prod = montarSemana({ ...base, produtosSemDescricao: 12 });
check('tarefa de descrição cai hoje', prod.map((t) => [t.id, t.dia, t.estado]), [['produtos-descricao', 2, 'aberta']]);
check('sem ferramenta de produto, não tem "Fazer com Alfred"', prod[0].prompt, undefined);
{
  const comTool = montarSemana({ ...base, produtosSemDescricao: 4, produtosSemImagem: 2, meliPropostasAguardando: 3, alfredFaz: { produtos: true, meli: true } });
  check('com ferramenta de produto, descrições ganham prompt', comTool.find((t) => t.id === 'produtos-descricao').prompt, PROMPT_DESCRICOES);
  check('foto de produto continua sem ferramenta', comTool.find((t) => t.id === 'produtos-imagem').prompt, undefined);
  check('com ferramenta do MELI, propostas ganham prompt', comTool.find((t) => t.id === 'meli-propostas').prompt, PROMPT_MELI);
}
{
  const enriquecer = montarSemana({ ...base, produtosSemDescricao: 1, produtosSemAtributos: 5, produtosSemAmbientada: 1, alfredFaz: { produtos: true } });
  check('atributos e ambientada viram tarefa com prompt', ['produtos-atributos', 'produtos-ambientada'].map((id) => enriquecer.find((t) => t.id === id)?.prompt), [PROMPT_ATRIBUTOS, PROMPT_AMBIENTADAS]);
  check('vêm depois da descrição (melhoram, não completam)', enriquecer.map((t) => t.id), ['produtos-descricao', 'produtos-atributos', 'produtos-ambientada']);
  check('título no singular e no plural', enriquecer.slice(1).map((t) => t.titulo), ['Preencher os atributos de 5 produtos', 'Criar imagens ambientadas de 1 produto']);
  const semTool = montarSemana({ ...base, produtosSemAtributos: 2, produtosSemAmbientada: 2 });
  check('sem ferramenta, levam à tela', semTool.map((t) => [t.prompt, t.destino]), [[undefined, 'produtos'], [undefined, 'produtos']]);
  check('zero ou ausente não cria tarefa', montarSemana({ ...base, produtosSemAtributos: 0 }), []);
}
check('plural e singular no título', montarSemana({ ...base, produtosSemDescricao: 1 })[0].titulo, 'Completar a descrição de 1 produto');

// O que precisa do usuário vem antes do que está só aberto.
const mix = montarSemana({ ...base, produtosSemDescricao: 3, meliPropostasAguardando: 2, acoes: [acao({})] });
check('precisa na frente de aberta', mix.map((t) => t.estado), ['precisa', 'precisa', 'aberta']);
check('próximo passo é o que precisa do usuário', proximoPasso(mix, 2)?.id, 'aprovacoes');

// Transbordo: no máximo MAX_POR_DIA abertas por dia, o resto vai pro dia seguinte.
const cheio = montarSemana({
  ...base,
  produtosSemDescricao: 1,
  produtosSemImagem: 1,
  meliPropostasAguardando: 1,
  acoes: [acao({})],
  integracoesComAlerta: ['Bling'],
});
check('quarta recebe só MAX_POR_DIA', cheio.filter((t) => t.dia === 2).length, MAX_POR_DIA);
check('o excedente vai pra quinta', cheio.filter((t) => t.dia === 3).map((t) => t.id), ['produtos-descricao', 'produtos-imagem']);

// Domingo não empurra nada pra semana seguinte.
const domingo = montarSemana({ ...base, hoje: new Date(2026, 9, 4, 10), produtosSemDescricao: 1, produtosSemImagem: 1, meliPropostasAguardando: 1, acoes: [acao({})] });
check('no domingo tudo fica no domingo', [...new Set(domingo.map((t) => t.dia))], [6]);

// Artigo agendado: fica no próprio dia, com estado derivado do status.
const artigos = montarSemana({
  ...base,
  artigos: [
    { id: 'x', titulo: 'Como escolher', scheduledDate: '2026-10-02', status: 'agendado' },
    { id: 'y', titulo: 'Guia', scheduledDate: '2026-09-28', status: 'publicado' },
    { id: 'z', titulo: 'Revisão', scheduledDate: '2026-09-30', status: 'revisao' },
    { id: 'w', titulo: 'Semana que vem', scheduledDate: '2026-10-06', status: 'agendado' },
  ],
});
check('artigos nos próprios dias, fora da semana ignorado', artigos.map((t) => [t.id, t.dia, t.estado]), [
  ['artigo-y', 0, 'feita'],
  ['artigo-z', 2, 'precisa'],
  ['artigo-x', 4, 'aberta'],
]);
check('artigo em aberto tem prompt (há ferramenta de conteúdo)', typeof artigos[2].prompt, 'string');
check('artigo publicado não tem prompt', artigos[0].prompt, undefined);

// Ação executada nesta semana vira "feita" no dia em que foi resolvida.
const feitas = montarSemana({
  ...base,
  acoes: [
    acao({ id: 'e1', status: 'executed', resolvedAt: new Date(2026, 8, 29, 9).toISOString() }),
    acao({ id: 'e2', status: 'executed', resolvedAt: new Date(2026, 8, 20, 9).toISOString() }),
    acao({ id: 'r1', status: 'rejected', resolvedAt: new Date(2026, 8, 29, 9).toISOString() }),
  ],
});
check('só a executada nesta semana entra', feitas.map((t) => [t.id, t.dia, t.estado]), [['acao-e1', 1, 'feita']]);
check('feitas não contam para o próximo passo', proximoPasso(feitas, 1), null);

// Imagem: qualquer URL de imagem (interna ou externa) conta.
check('sem nenhuma URL é sem imagem', semImagem({ 'Descrição': 'x' }), true);
check('URL vazia não conta', semImagem({ 'URL imagem 1': '  ' }), true);
check('URL externa conta', semImagem({ 'URL imagem externa 2': 'https://x/y.jpg' }), false);

if (failures) {
  console.error(`\n${failures} verificação(ões) falharam.`);
  process.exit(1);
}
// --- estimativas e fontes novas ---------------------------------------------
{
  const custos = { descricao: 3, ambientada: 5, video: 40 };
  const t = montarSemana({ ...base, produtosSemDescricao: 12, produtosSemAtributos: 2, produtosSemAmbientada: 9, custos, alfredFaz: { produtos: true } });
  const est = (id) => t.find((x) => x.id === id).estimativa;
  check('descrições: lote de 5, 3 créditos cada', est('produtos-descricao'), { minutos: 2, creditos: 15 });
  check('atributos são grátis', est('produtos-atributos'), { minutos: 1, creditos: 0 });
  check('ambientadas: lote de 3', est('produtos-ambientada'), { minutos: 2, creditos: 15 });
  check('texto da estimativa', [textoEstimativa({ minutos: 2, creditos: 15 }), textoEstimativa({ minutos: 1, creditos: 0 })], ['~2 min · 15 créditos', '~1 min · grátis']);
  check('sem custos carregados, só o tempo', montarSemana({ ...base, produtosSemDescricao: 1, alfredFaz: { produtos: true } })[0].estimativa, { minutos: 1, creditos: 0 });

  const seo = montarSemana({ ...base, alfredFaz: { content: true }, seoAchados: [
    { projeto: 'Loja', titulo: 'Sem H1', severidade: 'warning', paginas: 40 },
    { projeto: 'Loja', titulo: 'Links quebrados', severidade: 'error', paginas: 3 },
    { projeto: 'Loja', titulo: 'Title longo', severidade: 'warning', paginas: 12 },
    { projeto: 'Loja', titulo: 'Alt vazio', severidade: 'warning', paginas: 2 },
  ] });
  check('SEO: os 3 mais graves, erro primeiro', seo.map((x) => x.titulo), ['Corrigir: Links quebrados', 'Corrigir: Sem H1', 'Corrigir: Title longo']);
  check('SEO com ferramenta de conteúdo ganha prompt', !!seo[0].prompt, true);

  const ops = montarSemana({ ...base, alfredFaz: { tiny: true, wake: true }, produtosForaDoErp: 4 });
  check('pedidos do Tiny e banner da Wake viram tarefa', ['tiny-pedidos', 'wake-banner-fds'].map((id) => ops.find((x) => x.id === id)?.prompt), [PROMPT_PEDIDOS_TINY, PROMPT_BANNER]);
  check('banner do fim de semana cai na quinta', ops.find((x) => x.id === 'wake-banner-fds').dia, 3);
  check('no sábado o banner fica no próprio dia', montarSemana({ ...base, hoje: new Date(2026, 9, 3, 10), alfredFaz: { wake: true } }).find((x) => x.id === 'wake-banner-fds')?.dia, 5);
  check('fora do ERP leva à tela, sem prompt', [ops.find((x) => x.id === 'produtos-fora-erp').titulo, ops.find((x) => x.id === 'produtos-fora-erp').prompt], ['4 produtos estão fora do ERP', undefined]);

  const video = montarSemana({ ...base, videoSugerido: { sku: 'V1', nome: 'Luminária' }, alfredFaz: { produtos: true }, custos });
  check('vídeo sugerido', [video[0].titulo, video[0].prompt, video[0].estimativa], ['Vídeo para Luminária', 'Produza o vídeo do produto de SKU V1.', { minutos: 5, creditos: 40 }]);
  check('sem ferramenta de produto não sugere vídeo', montarSemana({ ...base, videoSugerido: { sku: 'V1', nome: 'x' } }), []);

  const m = montarSemana({ ...base, produtosSemDescricao: 2, missoes: [
    { id: 'erp', titulo: 'Conectar seu ERP', meta: 'publica direto', estado: 'agora' },
    { id: 'empresa', titulo: 'Completar dados da empresa', meta: 'nota', estado: 'opcional' },
  ] });
  check('missões abertas vêm primeiro, opcionais por último', m.map((x) => x.id), ['missao-erp', 'produtos-descricao', 'missao-empresa']);
  check('missão leva à própria missão', [m[0].destino, m[0].missao], ['missao', 'erp']);
}

// --- histórico semanal --------------------------------------------------------
{
  const ini = inicioDaSemana(QUARTA);
  check('chave da semana é a segunda local', chaveDaSemana(ini), '2026-09-28');
  const t1 = montarSemana({ ...base, produtosSemDescricao: 3, produtosSemImagem: 1 });
  const g1 = semanaParaGuardar(ini, t1);
  check('guarda total e feitas', [g1.total, g1.feitas], [2, 0]);
  // O usuário completou as descrições: a tarefa some da lista recalculada.
  const t2 = montarSemana({ ...base, produtosSemImagem: 1 });
  const g2 = semanaParaGuardar(ini, t2, g1);
  check('tarefa que sumiu fica como feita no histórico', g2.tarefas.map((t) => [t.id, t.estado]).sort(), [['produtos-descricao', 'feita'], ['produtos-imagem', 'aberta']]);
  check('feitas sobe', [g2.total, g2.feitas], [2, 1]);
  check('nada mudou, não grava de novo', [mesmaSemana(g1, semanaParaGuardar(ini, t1)), mesmaSemana(g1, g2), mesmaSemana(null, g1)], [true, false, false]);
}

console.log(failures ? `\n${failures} falha(s).` : '\nTudo certo.');
process.exit(failures ? 1 : 0);
