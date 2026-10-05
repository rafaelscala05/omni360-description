// Ritmo das chamadas à Wake em processos longos (importação de produtos).
//
// A Wake limita 120 requisições por minuto **por grupo de endpoints**, e esse
// limite é da loja inteira — o integrador do ERP usa o mesmo. Cinco
// requisições acima dele bloqueiam o token por 1 hora, derrubando também a
// integração. Uma importação que dispara todas as chamadas de uma vez estoura
// o limite em segundos, então ela passa por aqui: no máximo CHAMADAS_POR_MINUTO
// numa janela deslizante de 60 s, por token, neste processo.
//
// 36/min = 30% do limite: sobra para o integrador e para outra instância do
// servidor que esteja fazendo o mesmo.

export const CHAMADAS_POR_MINUTO = 36;
const JANELA_MS = 60_000;

export interface Relogio { agora(): number; dormir(ms: number): Promise<void> }
const relogioReal: Relogio = { agora: () => Date.now(), dormir: (ms) => new Promise((r) => setTimeout(r, ms)) };

interface Estado { marcas: number[]; fila: Promise<void> }
const porToken = new Map<string, Estado>();

/**
 * Espera uma vaga na janela e a reserva. Chamadas concorrentes (o Promise.all
 * de aggregateProduct) entram numa fila por token, então nunca furam o teto.
 * Devolve quanto tempo esperou, para o progresso mostrar.
 */
export function aguardarVaga(token: string, limite = CHAMADAS_POR_MINUTO, relogio: Relogio = relogioReal): Promise<number> {
  const e = porToken.get(token) ?? { marcas: [], fila: Promise.resolve() };
  porToken.set(token, e);
  let esperou = 0;
  const vez = e.fila.then(async () => {
    for (;;) {
      const agora = relogio.agora();
      e.marcas = e.marcas.filter((t) => agora - t < JANELA_MS);
      if (e.marcas.length < limite) { e.marcas.push(agora); return; }
      const espera = e.marcas[0] + JANELA_MS - agora + 5;
      esperou += espera;
      await relogio.dormir(espera);
    }
  });
  e.fila = vez.catch(() => {});
  return vez.then(() => esperou);
}

/** Só para testes: zera o estado de um token. */
export function esquecerToken(token: string): void {
  porToken.delete(token);
}
