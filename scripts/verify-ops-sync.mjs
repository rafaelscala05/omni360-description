// Verificação de ponta a ponta do sync de pedidos do Centro de Operações
// (server/ops/pedidosSync.ts), sem rede nem Firestore real: um Tiny falso que
// segue o contrato da API v2 (api2-pedidos-pesquisar / api2-pedidos-obter —
// 100 por página, `codigo_erro` 20 quando não há registros, situação devolvida
// como descrição) e um Firestore em memória com o pedaço da API que o sync usa.
// Rodar com: npx tsx scripts/verify-ops-sync.mjs
import { deps, ehCredencial, rodarCiclo, visitarSync, PEDIDOS_COL, SYNC_REF } from '../server/ops/pedidosSync.ts';
import { ID_SYNC_LOJA, LOJA_COL, rodarCicloLoja, visitarLoja } from '../server/ops/lojaSync.ts';
import { CHAMADAS_LOJA_POR_CICLO, estadoDoLoja, estadoInicialLoja } from '../src/modules/agent/ops/catalogo.ts';
import { diaBrt, estadoDoSync, estadoInicial, normalizarSituacao, somaDias } from '../src/modules/agent/ops/pedidos.ts';
import { painelPedidos } from '../src/modules/agent/ops/indicadores.ts';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  ok' : 'FALHA'}  ${label}${ok ? '' : ` → esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`}`);
}

// ---------------------------------------------------------------------------
// Firestore em memória
// ---------------------------------------------------------------------------
const store = new Map();
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const snapDe = (ref) => {
  const d = store.get(ref.path);
  return { id: ref.id, ref, exists: d !== undefined, data: () => clone(d) };
};
function docRef(path) {
  const id = path.split('/').pop();
  return {
    path, id,
    collection: (n) => colRef(`${path}/${n}`),
    get: async () => snapDe(docRef(path)),
    create: async (data) => { if (store.has(path)) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 }); store.set(path, clone(data)); },
    set: async (data, o) => { store.set(path, o?.merge ? { ...(store.get(path) ?? {}), ...clone(data) } : clone(data)); },
    update: async (data) => { if (!store.has(path)) throw new Error(`NOT_FOUND ${path}`); store.set(path, { ...store.get(path), ...clone(data) }); },
  };
}
function query(casa, filtros = [], lim = Infinity) {
  // Como no Firestore, `!=` não devolve doc sem o campo.
  const passa = (d) => filtros.every(([f, op, v]) => (op === '==' ? d[f] === v : op === '!=' ? d[f] !== undefined && d[f] !== v : op === '>=' ? d[f] >= v : op === '<=' ? d[f] != null && d[f] <= v : false));
  return {
    where: (f, op, v) => query(casa, [...filtros, [f, op, v]], lim),
    limit: (n) => query(casa, filtros, n),
    get: async () => {
      const docs = [...store.entries()].filter(([p, d]) => casa(p) && passa(d)).slice(0, lim).map(([p]) => snapDe(docRef(p)));
      return { docs, size: docs.length, empty: !docs.length };
    },
  };
}
function colRef(path) {
  const q = query((p) => p.startsWith(`${path}/`) && !p.slice(path.length + 1).includes('/'));
  return { path, doc: (id) => docRef(`${path}/${id}`), ...q };
}
const fakeDb = {
  collection: (n) => colRef(n),
  collectionGroup: (n) => query((p) => { const s = p.split('/'); return s.length % 2 === 0 && s[s.length - 2] === n; }),
  getAll: async (...refs) => refs.map(snapDe),
  batch: () => {
    const ops = [];
    return {
      set: (ref, data, o) => ops.push(() => ref.set(data, o)),
      delete: (ref) => ops.push(async () => { store.delete(ref.path); }),
      commit: async () => { for (const op of ops) await op(); },
    };
  },
  runTransaction: async (fn) => {
    const ops = [];
    const r = await fn({ get: async (ref) => snapDe(ref), update: (ref, data) => ops.push(() => ref.update(data)) });
    for (const op of ops) await op();
    return r;
  },
};

// ---------------------------------------------------------------------------
// Tiny falso (contrato da v2)
// ---------------------------------------------------------------------------
const AGORA = Date.now();
const hoje = diaBrt(AGORA);
const BRT_MS = 3 * 3600_000;
const br = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const SITUACOES = ['Em aberto', 'Aprovado', 'Preparando envio', 'Faturado (atendido)', 'Pronto para envio', 'Enviado', 'Entregue', 'Cancelado', 'Não Entregue'];
const CANAIS = [{ nomeEcommerce: 'Wake', canalVenda: 'Loja Wake' }, { nomeEcommerce: 'Integrador', canalVenda: 'Mercado Livre' }, null];

const tiny = {
  pedidos: [],
  chamadas: 0,
  recusaAtualizacao: false,
  tokenInvalido: false,
  quebraBackfill: false,
};
let seq = 1000;
function novoPedido(diasAtras, extra = {}) {
  const id = seq++;
  const data = somaDias(hoje, -diasAtras);
  const itens = Array.from({ length: 1 + (id % 3) }, (_, k) => ({ codigo: `SKU-${(id + k) % 7}`, quantidade: String(1 + (k % 2)), valor_unitario: '50.00' }));
  const total = itens.reduce((s, i) => s + Number(i.quantidade) * 50, 0);
  return {
    id, numero: id - 900, data, situacao: SITUACOES[id % SITUACOES.length], total,
    itens, ecommerce: CANAIS[id % 3],
    // Alterado ao meio-dia (Brasília) do dia do pedido.
    atualizadoMs: Date.parse(`${data}T12:00:00Z`) + BRT_MS,
    ...extra,
  };
}
// 101 dias de pedidos, ~3,5 por dia — os mais antigos ficam fora dos 90 do backfill.
for (let d = 0; d <= 100; d++) for (let k = 0; k < (d % 2 ? 3 : 4); k++) tiny.pedidos.push(novoPedido(d));

// Plano Crescer: 30 chamadas/min (api2-limites-api), informado em `x-limit-api`.
const respostaJson = (retorno) => new Response(JSON.stringify({ retorno }), { status: 200, headers: { 'content-type': 'application/json', 'x-limit-api': '30' } });
const erro = (codigo_erro, msg) => respostaJson({ status_processamento: 2, status: 'Erro', codigo_erro, erros: [{ erro: msg }] });
const isoDeBr = (s) => `${s.slice(6, 10)}-${s.slice(3, 5)}-${s.slice(0, 2)}`;

// ---------------------------------------------------------------------------
// Wake falsa (GET /produtos: 50 por página, cursor produtoVarianteIdDe exclusivo,
// header X-Ultimo-Produto-Variante-Id, alteradosPartirDe em aaaa-mm-dd hh:mm:ss)
// ---------------------------------------------------------------------------
const wake = { produtos: [], chamadas: 0, limite: false, tokenInvalido: false, vazioComo404: true };
for (let id = 1; id <= 230; id++) {
  wake.produtos.push({ produtoVarianteId: id, produtoId: id, sku: `W-${id}`, nome: `Produto ${id}`, precoPor: 100, precoDe: id % 10 === 0 ? 130 : 0, precoCusto: id % 7 === 0 ? 60 : 0, exibirSite: id % 25 !== 0, valido: true, estoque: [{ estoqueFisico: id % 5, estoqueReservado: 0 }, { estoqueFisico: 1, estoqueReservado: 1 }], atualizadoMs: AGORA - 5 * 86_400_000 });
}
function respostaWake(url) {
  wake.chamadas++;
  if (wake.limite) return new Response('{"mensagem":"limite"}', { status: 429, headers: { 'retry-after': '30' } });
  if (wake.tokenInvalido) return new Response('{}', { status: 401 });
  const u = new URL(url);
  const cursor = Number(u.searchParams.get('produtoVarianteIdDe') ?? 0);
  const alt = u.searchParams.get('alteradosPartirDe');
  if (u.searchParams.get('pagina')) return new Response('{"mensagem":"pagina descontinuado"}', { status: 400 });
  if (u.searchParams.get('camposAdicionais') !== 'Estoque') return new Response('{"mensagem":"sem estoque"}', { status: 400 });
  let lista = wake.produtos.filter((p) => p.produtoVarianteId > cursor).sort((a, b) => a.produtoVarianteId - b.produtoVarianteId);
  if (alt) {
    const desde = Date.parse(`${alt.replace(' ', 'T')}Z`) + BRT_MS;
    if (AGORA - desde > 48 * 3600_000 + 60_000) return new Response('{"mensagem":"máximo 48 horas"}', { status: 400 });
    lista = lista.filter((p) => p.atualizadoMs >= desde);
  }
  const pagina = lista.slice(0, Number(u.searchParams.get('quantidadeRegistros') ?? 50));
  if (!pagina.length && wake.vazioComo404) return new Response('', { status: 404 });
  const headers = { 'content-type': 'application/json' };
  if (pagina.length) headers['X-Ultimo-Produto-Variante-Id'] = String(pagina[pagina.length - 1].produtoVarianteId);
  return new Response(JSON.stringify(pagina.map(({ atualizadoMs, ...p }) => p)), { status: 200, headers });
}

globalThis.fetch = async (url, init) => {
  if (String(url).includes('api.fbits.net')) return respostaWake(String(url));
  tiny.chamadas++;
  const endpoint = String(url).split('/').pop();
  const p = Object.fromEntries(new URLSearchParams(String(init.body)));
  if (tiny.tokenInvalido) return erro(2, 'Token inválido ou não informado');
  if (endpoint === 'pedidos.pesquisa.php') {
    // (1) "Ao menos um desses parâmetros deve ser informado."
    if (!p.dataInicial && !p.dataFinal && !p.dataAtualizacao && !p.situacao && !p.numero) return erro(31, 'Informe ao menos um filtro');
    if (p.dataAtualizacao && tiny.recusaAtualizacao) return erro(31, 'Data de atualização inválida');
    if (p.dataInicial && tiny.quebraBackfill) return erro(31, 'Data inicial inválida');
    let lista = tiny.pedidos;
    if (p.dataInicial) lista = lista.filter((x) => x.data >= isoDeBr(p.dataInicial));
    if (p.dataFinal) lista = lista.filter((x) => x.data <= isoDeBr(p.dataFinal));
    if (p.dataAtualizacao) {
      const [d, h] = p.dataAtualizacao.split(' ');
      const desde = Date.parse(`${isoDeBr(d)}T${h}Z`) + BRT_MS;
      lista = lista.filter((x) => x.atualizadoMs >= desde);
    }
    if (!lista.length) return erro(20, 'A consulta não retornou registros');
    const pagina = Number(p.pagina ?? 1);
    const paginas = Math.ceil(lista.length / 100);
    return respostaJson({
      status_processamento: 3, status: 'OK', pagina, numero_paginas: paginas,
      pedidos: lista.slice((pagina - 1) * 100, pagina * 100).map((x) => ({
        pedido: { id: x.id, numero: x.numero, numero_ecommerce: '', data_pedido: br(x.data), data_prevista: '', nome: 'Cliente', valor: x.total.toFixed(2), id_vendedor: 0, nome_vendedor: '', situacao: x.situacao, codigo_rastreamento: '' },
      })),
    });
  }
  if (endpoint === 'pedido.obter.php') {
    const x = tiny.pedidos.find((o) => String(o.id) === p.id);
    if (!x) return erro(20, 'A consulta não retornou registros');
    return respostaJson({
      status_processamento: 3, status: 'OK',
      pedido: {
        id: x.id, numero: x.numero, data_pedido: br(x.data), total_pedido: x.total.toFixed(2), situacao: x.situacao,
        data_envio: x.dataEnvio ?? '', data_entrega: x.dataEntrega ?? '', forma_envio: x.formaEnvio ?? '',
        itens: x.itens.map((item) => ({ item })),
        ...(x.ecommerce ? { ecommerce: { id: 1, numeroPedidoEcommerce: `EC-${x.id}`, ...x.ecommerce } } : {}),
      },
    });
  }
  return erro(99, `endpoint inesperado ${endpoint}`);
};

// ---------------------------------------------------------------------------
// Ligação
// ---------------------------------------------------------------------------
const falhasLogadas = [];
deps.db = fakeDb;
deps.tokenTiny = async (uid) => (uid === 'sem-token' ? null : 'tok');
deps.tokenWake = async (uid) => (uid === 'sem-token' ? null : 'tok-wake');
deps.logFalha = async (uid, e) => { falhasLogadas.push([uid, e.erro]); };
console.error = () => {}; // tinyV2CallRaw loga cada "Erro" do Tiny; aqui são esperados.

const estado = async (uid) => (await SYNC_REF(uid, 'tiny').get()).data();
const pedidosDe = async (uid) => (await PEDIDOS_COL(uid).get()).docs.map((d) => d.data());
const criar = (uid) => SYNC_REF(uid, 'tiny').set(estadoInicial('tiny', Date.now()));

async function convergir(uid, max = 120) {
  const porCiclo = [];
  for (let i = 0; i < max; i++) {
    tiny.chamadas = 0;
    await rodarCiclo(uid, 'tiny', { forcar: true });
    porCiclo.push(tiny.chamadas);
    const s = await estado(uid);
    const pend = (await pedidosDe(uid)).some((p) => !p.detalhado);
    if (s.erro || (estadoDoSync(s, Date.now()).estado === 'em-dia' && !pend && s.incremental.inicioRodada == null)) break;
  }
  return porCiclo;
}

// --- 1 · Importação completa -------------------------------------------------
await criar('u1');
const ciclos = await convergir('u1');
const s1 = await estado('u1');
const alvo = somaDias(hoje, -90);
const esperados = tiny.pedidos.filter((x) => x.data >= alvo);
const gravados = await pedidosDe('u1');
check('1º ciclo, limite ainda desconhecido: no máximo 6 chamadas', ciclos[0] <= 6, true);
check('depois, 30% dos 30/min do plano: no máximo 9 por ciclo', ciclos.slice(1).every((n) => n <= 9), true);
console.log(`        (${ciclos.length} ciclos: ${ciclos.join(', ')} chamadas)`);
check('histórico de 90 dias importado inteiro', gravados.length, esperados.length);
check('nada mais antigo que o alvo', gravados.every((p) => p.data >= alvo), true);
check('todo pedido detalhado, sem falha de detalhe', [gravados.every((p) => p.detalhado), gravados.some((p) => p.detalheFalhou)], [true, false]);
check('sync em dia, modo por data de alteração, limite do plano salvo', [estadoDoSync(s1, Date.now()).estado, s1.incremental.modo, s1.erro, s1.limitePorMinuto], ['em-dia', 'atualizacao', null, 30]);
check('próximo ciclo em ~15 min', Math.round((s1.proximaEm - Date.now()) / 60_000), 15);
check('lease solto', [s1.leaseId, s1.leaseUntil], [null, null]);

const amostra = tiny.pedidos.find((x) => x.ecommerce?.canalVenda === 'Mercado Livre' && x.data >= alvo);
const g = gravados.find((p) => p.idExterno === String(amostra.id));
check('detalhe: canal, itens e valor do pedido.obter', [g.canal, g.itens.length, g.valor], ['Mercado Livre', amostra.itens.length, amostra.total]);
check('pedido sem e-commerce → Sem canal', gravados.find((p) => p.idExterno === String(tiny.pedidos.find((x) => !x.ecommerce && x.data >= alvo).id)).canal, 'Sem canal');
check('situação devolvida como descrição é normalizada', g.situacao, normalizarSituacao(amostra.situacao));

// Os números do painel batem com a conta feita direto sobre o Tiny falso.
const painel = painelPedidos(gravados, Date.now());
const de30 = tiny.pedidos.filter((x) => x.data >= somaDias(hoje, -29) && normalizarSituacao(x.situacao) !== 'cancelado');
check('receita de 30 dias = soma direta no Tiny', painel.periodos.d30.receita, de30.reduce((s, x) => s + x.total, 0));
check('pedidos de 30 dias = contagem direta no Tiny', painel.periodos.d30.pedidos, de30.length);
check('todos os pedidos de 30 dias com itens', painel.detalhados, 1);

// --- 2 · Incremental ------------------------------------------------------------
const mudou = tiny.pedidos.find((x) => x.data === somaDias(hoje, -2));
mudou.situacao = 'Cancelado';
mudou.atualizadoMs = Date.now();
const novo = novoPedido(0, { atualizadoMs: Date.now() });
tiny.pedidos.push(novo);
tiny.chamadas = 0;
await rodarCiclo('u1', 'tiny', { forcar: true });
const depois = await pedidosDe('u1');
check('incremental pega a mudança de situação', depois.find((p) => p.idExterno === String(mudou.id)).situacao, 'cancelado');
check('incremental traz o pedido novo já detalhado', depois.find((p) => p.idExterno === String(novo.id))?.detalhado, true);
check('ciclo em dia gasta poucas chamadas', tiny.chamadas <= 3, true);

// --- 3 · Tiny recusa dataAtualizacao ------------------------------------------
tiny.recusaAtualizacao = true;
await criar('u2');
await convergir('u2');
const s2 = await estado('u2');
check('recusa de dataAtualizacao vira modo janela, sem pausar como credencial', [s2.incremental.modo, s2.erro, s2.proximaEm != null], ['janela', null, true]);
check('modo janela importa o mesmo histórico', (await pedidosDe('u2')).length, (await pedidosDe('u1')).length);
tiny.recusaAtualizacao = false;

// --- 4 · Erros ------------------------------------------------------------------
check('"Data inválida" (401 do tinyV2CallRaw) não é credencial', ehCredencial(Object.assign(new Error('[cod 31] Data inicial inválida'), { status: 401 })), false);
check('"Token inválido" é credencial', ehCredencial(Object.assign(new Error('[cod 2] Token inválido ou não informado'), { status: 401 })), true);

await criar('sem-token');
await rodarCiclo('sem-token', 'tiny', { forcar: true });
const s3 = await estado('sem-token');
check('sem token: pausa como credencial', [s3.erro, s3.proximaEm], ['credencial', null]);

tiny.tokenInvalido = true;
await criar('u3');
await rodarCiclo('u3', 'tiny', { forcar: true });
const s4 = await estado('u3');
check('token recusado pelo Tiny: pausa como credencial', [s4.erro, s4.proximaEm], ['credencial', null]);
tiny.tokenInvalido = false;

tiny.quebraBackfill = true;
await criar('u4');
await rodarCiclo('u4', 'tiny', { forcar: true });
const s5 = await estado('u4');
check('parâmetro ruim no backfill: erro com backoff, não credencial', [s5.erro?.includes('Data inicial'), s5.proximaEm > Date.now(), s5.falhas], [true, true, 1]);
check('falha vai para o log, sucesso não', falhasLogadas.every(([uid]) => uid !== 'u1'), true);
tiny.quebraBackfill = false;

// --- 5 · Visita e inatividade -------------------------------------------------
await SYNC_REF('u1', 'tiny').update({ ultimaVisita: Date.now() - 15 * 86_400_000 });
await rodarCiclo('u1', 'tiny', { forcar: true });
check('14 dias sem visita: pausa', (await estado('u1')).proximaEm, null);
tiny.chamadas = 0;
const v = await visitarSync('u1', 'tiny');
check('a visita religa', [v.proximaEm != null, v.erro], [true, null]);

const c1 = await visitarSync('sem-token', 'tiny');
check('visita religa conta pausada por credencial', c1.proximaEm != null, true);
await visitarSync('novo', 'tiny').catch(() => {});
const criado = await estado('novo');
check('primeira visita cria o estado', [criado?.fonte, criado?.backfill.alvo], ['tiny', alvo]);


// --- 6 · Entrega: datas do pedido.obter ----------------------------------------
// A visita acima disparou um ciclo em segundo plano: espera ele soltar o lease.
for (let i = 0; i < 100 && (await estado('u1')).leaseUntil; i++) await new Promise((r) => setTimeout(r, 50));
const comDatas = (await pedidosDe('u1')).find((p) => p.situacao === 'entregue');
check('pedido detalhado guarda as datas (null quando não há)', [comDatas.dataEnvio, comDatas.dataEntrega, comDatas.formaEnvio], [null, null, null]);
const vaiSair = tiny.pedidos.find((x) => x.data === somaDias(hoje, -1));
vaiSair.situacao = 'Entregue';
vaiSair.dataEnvio = br(hoje);
vaiSair.dataEntrega = br(hoje);
vaiSair.formaEnvio = 'SEDEX';
vaiSair.atualizadoMs = Date.now();
await SYNC_REF('u1', 'tiny').update({ ultimaVisita: Date.now() });
await rodarCiclo('u1', 'tiny', { forcar: true });
const saiu = (await pedidosDe('u1')).find((p) => p.idExterno === String(vaiSair.id));
check('mudar de situação pede o detalhe de novo e traz envio/entrega', [saiu.situacao, saiu.dataEnvio, saiu.dataEntrega, saiu.formaEnvio], ['entregue', hoje, hoje, 'SEDEX']);

// --- 7 · Catálogo da loja (Wake) --------------------------------------------------
const estadoL = async (uid) => (await SYNC_REF(uid, ID_SYNC_LOJA).get()).data();
const lojaDe = async (uid) => (await LOJA_COL(uid).get()).docs.map((d) => d.data());
await SYNC_REF('w1', ID_SYNC_LOJA).set(estadoInicialLoja(Date.now()));
const ciclosL = [];
for (let i = 0; i < 20; i++) {
  wake.chamadas = 0;
  await rodarCicloLoja('w1', { forcar: true });
  ciclosL.push(wake.chamadas);
  if ((await estadoL('w1')).varredura.ultimaConcluidaEm) break;
}
const l1 = await estadoL('w1');
check(`nenhum ciclo da loja passa de ${CHAMADAS_LOJA_POR_CICLO} chamadas`, ciclosL.every((n) => n <= CHAMADAS_LOJA_POR_CICLO), true);
console.log(`        (${ciclosL.length} ciclos: ${ciclosL.join(', ')} chamadas)`);
check('varredura completa: todas as 230 variantes', (await lojaDe('w1')).length, 230);
check('loja em dia, incremental armado', [estadoDoLoja(l1).estado, l1.varredura.rodada, l1.incremental.desde != null], ['em-dia', null, true]);
const w7 = (await lojaDe('w1')).find((x) => x.sku === 'W-7');
check('estoque somado nos CDs (físico − reservado) e custo da Wake', [w7.estoque, w7.precoCusto, w7.exibirSite], [2, 60, true]);

// Incremental: preço alterado e produto novo; Wake responde 404 quando não há nada.
wake.produtos[0].precoPor = 79.9;
wake.produtos[0].atualizadoMs = Date.now();
wake.produtos.push({ ...wake.produtos[1], produtoVarianteId: 231, produtoId: 231, sku: 'W-231', atualizadoMs: Date.now() });
wake.chamadas = 0;
await rodarCicloLoja('w1', { forcar: true });
const l2 = await lojaDe('w1');
check('incremental: preço novo e produto novo, numa chamada', [l2.find((x) => x.sku === 'W-1').precoPor, l2.some((x) => x.sku === 'W-231'), wake.chamadas], [79.9, true, 1]);
check('produto que entrou pelo incremental tem rodada (a limpeza o enxerga)', l2.find((x) => x.sku === 'W-231').rodada, 'inc');
wake.chamadas = 0;
await rodarCicloLoja('w1', { forcar: true });
check('incremental sem alteração: 404 vira lista vazia', [wake.chamadas, (await estadoL('w1')).erro], [1, null]);

// Varredura seguinte apaga o que saiu da loja (inclusive o que veio pelo incremental).
wake.produtos = wake.produtos.filter((p) => p.produtoVarianteId !== 5 && p.produtoVarianteId !== 231);
await SYNC_REF('w1', ID_SYNC_LOJA).update({ 'varredura': { ...(await estadoL('w1')).varredura, ultimaConcluidaEm: Date.now() - 25 * 3600_000 } });
for (let i = 0; i < 20; i++) { await rodarCicloLoja('w1', { forcar: true }); if (!(await estadoL('w1')).varredura.rodada) break; }
const l3 = await lojaDe('w1');
check('varredura de 24 h remove o que saiu da loja', [l3.length, l3.some((x) => x.sku === 'W-5'), l3.some((x) => x.sku === 'W-231')], [229, false, false]);

// 429: nenhuma repetição, espera o Retry-After, retoma do cursor.
await SYNC_REF('w2', ID_SYNC_LOJA).set(estadoInicialLoja(Date.now()));
await rodarCicloLoja('w2', { forcar: true });
const cursorAntes = (await estadoL('w2')).varredura.cursor;
wake.limite = true;
wake.chamadas = 0;
await rodarCicloLoja('w2', { forcar: true });
const l429 = await estadoL('w2');
check('429: uma chamada só, sem retry (5 acima do limite bloqueiam o token)', wake.chamadas, 1);
check('429: espera o Retry-After e não conta como falha', [Math.round((l429.proximaEm - Date.now()) / 1000), l429.erro ?? null, l429.varredura.cursor], [35, null, cursorAntes]);
wake.limite = false;

wake.tokenInvalido = true;
await SYNC_REF('w3', ID_SYNC_LOJA).set(estadoInicialLoja(Date.now()));
await rodarCicloLoja('w3', { forcar: true });
check('token da Wake recusado: pausa como credencial', [(await estadoL('w3')).erro, (await estadoL('w3')).proximaEm], ['credencial', null]);
wake.tokenInvalido = false;
await SYNC_REF('sem-token', ID_SYNC_LOJA).set(estadoInicialLoja(Date.now()));
await rodarCicloLoja('sem-token', { forcar: true });
check('sem token da Wake: pausa como credencial', (await estadoL('sem-token')).erro, 'credencial');
const vl = await visitarLoja('w3');
check('visita religa o catálogo pausado', [vl.proximaEm != null, vl.erro], [true, null]);

// Deixa os ciclos disparados em segundo plano pela visita terminarem.
await new Promise((r) => setTimeout(r, 200));
console.log(failures ? `\n${failures} falha(s).` : '\nTudo certo.');
process.exit(failures ? 1 : 0);
