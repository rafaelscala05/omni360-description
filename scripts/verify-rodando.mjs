// Verificação da aba "Rodando" da Atividade (src/modules/agent/rodando.ts).
// Rodar com: npx tsx scripts/verify-rodando.mjs
import { itensRodando, PARADO_MS, ESQUECER_MS } from '../src/modules/agent/rodando.ts';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  ok' : 'FALHA'}  ${label}${ok ? '' : ` → esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`}`);
}
const AGORA = Date.parse('2026-09-30T15:00:00Z');
const ha = (ms) => new Date(AGORA - ms).toISOString();
const nomes = new Map([['p1', 'Tênis Runner']]);
const r = itensRodando({
  classico: [
    { jobId: 'a', productId: 'p1', status: 'processing', step: 'shot', shotsDone: 2, totalShots: 4, updatedAt: ha(60_000) },
    { jobId: 'b', productId: 'p1', status: 'done', updatedAt: ha(1000) },
    { jobId: 'c', productId: 'x', status: 'queued', updatedAt: ha(ESQUECER_MS + 1) },
  ],
  ugc: [
    { jobId: 'd', productId: 'x', status: 'processing', step: 'post', updatedAt: ha(PARADO_MS + 1) },
    { jobId: 'e', productId: 'p1', status: 'queued', createdAt: ha(5000) },
  ],
}, (id) => nomes.get(id), AGORA);

check('só queued/processing e não esquecidos', r.map((i) => i.id), ['Vídeo UGC-e', 'Vídeo-a', 'Vídeo UGC-d']);
check('progresso por cenas', [r[1].feito, r[1].total, r[1].etapa], [2, 4, 'gerando as cenas']);
check('nome do produto no título', r[1].titulo, 'Vídeo · Tênis Runner');
check('produto desconhecido não quebra o título', r[2].titulo, 'Vídeo UGC');
check('fila sem total', [r[0].etapa, r[0].total], ['na fila', null]);
check('parado vai para o fim e é marcado', [r[2].parado, r[2].etapa], [true, 'montando o vídeo']);

console.log(failures ? `\n${failures} falha(s).` : '\nTudo certo.');
process.exit(failures ? 1 : 0);
