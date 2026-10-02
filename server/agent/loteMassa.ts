// "Gerar descrição/imagem para todas" da tela de Produtos, sem passar pelo
// modelo: a tela já mostrou a confirmação (confirmacaoMassa.ts) e o usuário
// escolheu pular ou sobrescrever. Aqui a mesma conta é refeita — o corpo vem do
// navegador —, os produtos viram lotes em modo automático (cada item é gravado
// assim que fica pronto, débito por item gravado) e a troca vai para a conversa
// para os cards aparecerem no painel e na aba Alfred.

import {
  alvos, emLotes, FERRAMENTAS_MASSA, listaNomes, montarConfirmacao, TAMANHO_LOTE,
  type CandidatoMassa, type FerramentaMassa,
} from '../../src/modules/agent/confirmacaoMassa';
import { camposDeRestauro, marcarDesfeito, podeRestaurar, type AntesDescricao } from '../../src/modules/agent/lote';
import { adminDb } from '../firebaseAdmin';
import { criarLote, lerLote, mutarLote } from './loteStore';
import { scheduleLote } from './loteWorker';
import { fotoPrincipal, lerCatalogo, produtosCol } from './produtosGeracao';
import { estimateCredits } from './execution';
import { registrarTrocaNaConversa } from './contentAgentChat';
import type { ProdutoDoc } from './produtosRules';

export interface RespostaMassa { actionIds: string[]; lotes: number; gerados: number; jaTem: number; semFoto: number; custo: number }

const MAX_IDS = 1000;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
const erro = (msg: string, status: number) => Object.assign(new Error(msg), { status });

const candidato = (p: ProdutoDoc): CandidatoMassa => ({
  id: p._docId,
  nome: str(p['Descrição']) || str(p['Código (SKU)']) || '(sem nome)',
  temDescricao: !!str(p['Descrição complementar']),
  temAmbientada: ((p._ambientImages as unknown[] | undefined) ?? []).length > 0,
  temFoto: !!fotoPrincipal(p),
});

const antesDe = (p: ProdutoDoc): AntesDescricao => ({
  tituloSeo: str(p['Título SEO']),
  descricaoSeo: str(p['Descrição SEO']),
  palavrasChave: str(p['Palavras chave SEO']),
  statusDescricao: typeof p._statusDescricao === 'string' ? p._statusDescricao : null,
  statusSEO: typeof p._statusSEO === 'string' ? p._statusSEO : null,
});

export async function criarLotesEmMassa(
  uid: string,
  corpo: { ferramenta?: unknown; docIds?: unknown; sobrescrever?: unknown },
): Promise<RespostaMassa> {
  const ferramenta = corpo.ferramenta as FerramentaMassa;
  if (!FERRAMENTAS_MASSA.includes(ferramenta)) throw erro('Ferramenta não suportada.', 400);
  const ids = Array.isArray(corpo.docIds) ? [...new Set(corpo.docIds.filter((i): i is string => typeof i === 'string'))] : [];
  if (!ids.length) throw erro('Nenhum produto selecionado.', 400);
  if (ids.length > MAX_IDS) throw erro(`No máximo ${MAX_IDS} produtos por vez.`, 400);
  const sobrescrever = corpo.sobrescrever === true;

  // Só produtos do próprio usuário (lidos da coleção dele) e só principais.
  const porDoc = new Map((await lerCatalogo(uid)).map((p) => [p._docId, p]));
  const produtos = ids.map((id) => porDoc.get(id)).filter((p): p is ProdutoDoc => !!p && !str(p['Código do pai']));
  if (!produtos.length) throw erro('Nenhum dos produtos foi encontrado no catálogo.', 404);

  const def = { name: ferramenta, provider: 'produtos' as const };
  const custoUnitario = await estimateCredits(def, { payload: { itens: [produtos[0]] } });
  const conf = montarConfirmacao(ferramenta, produtos.map(candidato), custoUnitario);
  const escolhidos = alvos(conf, sobrescrever);
  if (!escolhidos.length) {
    throw erro(conf.semFoto.length === conf.total ? 'Nenhum dos produtos tem foto para servir de base.' : 'Todos já têm — escolha sobrescrever para gerar de novo.', 409);
  }
  const custo = escolhidos.length * custoUnitario;
  const saldo = Number((await adminDb.collection('users').doc(uid).get()).data()?.credits ?? 0);
  if (saldo < custo) throw erro(`Isto custa até ${custo} créditos e o saldo é ${saldo}.`, 402);

  const imagem = ferramenta === 'produtos.ambientadas.gerar';
  const partes = emLotes(escolhidos, TAMANHO_LOTE[ferramenta]);
  const actionIds: string[] = [];
  for (const [k, parte] of partes.entries()) {
    const docs = parte.map((c) => porDoc.get(c.id)!);
    const n = docs.length;
    const { job } = await criarLote({
      uid,
      tool: ferramenta,
      provider: 'produtos',
      // docIds + modo na chave: repetir o mesmo pedido enquanto ele roda reencontra o lote.
      args: { docIds: parte.map((c) => c.id), sobrescrever, origem: 'massa' },
      itens: docs.map((p) => ({
        docId: p._docId,
        sku: str(p['Código (SKU)']),
        nome: candidato(p).nome,
        ...(imagem ? {} : { descricaoAntes: String(p['Descrição complementar'] ?? ''), antes: antesDe(p) }),
      })),
      preview: {
        resumo: imagem
          ? `Criar imagens ambientadas de ${n === 1 ? '1 produto' : `${n} produtos`}`
          : `Escrever ${n === 1 ? 'a descrição de 1 produto' : `as descrições de ${n} produtos`}`,
        alvo: partes.length > 1 ? `Lote ${k + 1} de ${partes.length} · ${listaNomes(parte)}` : listaNomes(parte),
        campos: [],
        avisos: [imagem
          ? 'As imagens são acrescentadas ao produto (as ambientadas que ele já tem continuam). Nada vai ao ERP.'
          : 'Grava só no catálogo do OMNI360 (descrição e SEO). Nada vai ao ERP.'],
        custo: n * custoUnitario,
      },
      auto: true,
    });
    // origem no job (criarLote não conhece o campo): marca numa transação.
    await mutarLote(uid, job.id, (j) => ({ ...j, origem: 'massa' }));
    scheduleLote(uid, job.id);
    actionIds.push(job.actionId);
  }

  const oque = imagem ? 'imagens ambientadas' : 'descrição';
  const nAlvo = escolhidos.length;
  const textoUsuario = `Gerar ${oque} para ${nAlvo} ${nAlvo === 1 ? 'produto' : 'produtos'}${sobrescrever ? ' (sobrescrevendo os que já têm)' : conf.jaTem.length ? ` (pulando ${conf.jaTem.length} que já ${conf.jaTem.length === 1 ? 'tem' : 'têm'})` : ''}.`;
  const textoAlfred = partes.length > 1
    ? `Comecei. Dividi em ${partes.length} lotes; cada item é gravado assim que fica pronto.`
    : 'Comecei. Cada item é gravado assim que fica pronto.';
  await registrarTrocaNaConversa(uid, textoUsuario, textoAlfred, actionIds);

  return { actionIds, lotes: partes.length, gerados: nAlvo, jaTem: conf.jaTem.length, semFoto: conf.semFoto.length, custo };
}

/**
 * Desfaz um lote concluído. Descrição: devolve texto, SEO e status de antes
 * (e a descrição das variações), só onde o texto atual ainda é o que o lote
 * gravou. Imagens: tira de `_ambientImages` as URLs que o lote acrescentou.
 * Não estorna créditos. Marcado `desfeito` antes de escrever: duplo clique
 * não roda duas vezes.
 */
export async function desfazerLote(uid: string, id: string): Promise<{ restaurados: number; mantidos: number }> {
  const job = await mutarLote(uid, id, (j) => marcarDesfeito(j, new Date().toISOString()));
  if (!job) throw erro('Este lote não pode ser desfeito.', 409);
  let restaurados = 0;
  let mantidos = 0;
  const agora = new Date().toISOString();
  for (const item of job.itens) {
    if (item.estado !== 'gravado' || !item.resultado) continue;
    const ref = produtosCol(uid).doc(item.docId);
    const snap = await ref.get();
    if (!snap.exists) { mantidos++; continue; }
    const atual = snap.data() as Record<string, unknown>;
    if ('imagens' in item.resultado) {
      const remover = new Set(item.resultado.imagens);
      const imgs = ((atual._ambientImages as string[] | undefined) ?? []).filter((u) => !remover.has(u));
      await ref.update({ _ambientImages: imgs, updatedAt: agora });
      restaurados++;
      continue;
    }
    const campos = camposDeRestauro(item);
    const gravada = 'descricao' in item.resultado ? item.resultado.descricao : '';
    if (!campos || !podeRestaurar(String(atual['Descrição complementar'] ?? ''), gravada)) { mantidos++; continue; }
    const batch = adminDb.batch();
    batch.update(ref, { ...campos, updatedAt: agora });
    if (item.sku) {
      const filhas = await produtosCol(uid).where('Código do pai', '==', item.sku).get();
      filhas.docs
        .filter((f) => podeRestaurar(String(f.data()['Descrição complementar'] ?? ''), gravada))
        .forEach((f) => batch.update(f.ref, { 'Descrição complementar': item.descricaoAntes ?? '', updatedAt: agora }));
    }
    await batch.commit();
    restaurados++;
  }
  return { restaurados, mantidos };
}
