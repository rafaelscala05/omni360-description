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
console.log('\nTudo certo.');
