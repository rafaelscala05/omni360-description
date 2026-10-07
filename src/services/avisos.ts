// Avisos do app (toasts) — o substituto do alert() nativo, que trava a tela e
// quebra o fluxo. Store de módulo, sem contexto: qualquer serviço ou handler
// chama `avisar(...)`, e o <Avisos /> montado no App desenha.
//
//   ok    → some sozinho em 3,5 s
//   info  → some sozinho em 5 s
//   erro  → fica até fechar (e pode oferecer "Tentar de novo")

export type TomAviso = 'ok' | 'erro' | 'info';

export interface Aviso {
  id: number;
  tom: TomAviso;
  texto: string;
  acao?: { rotulo: string; onClick: () => void };
  /** ms; 0 = só fecha à mão. */
  duracao: number;
}

type Ouvinte = (avisos: Aviso[]) => void;

let lista: Aviso[] = [];
let proximoId = 1;
const ouvintes = new Set<Ouvinte>();
const MAX = 4;

function emitir() {
  for (const o of ouvintes) o(lista);
}

export function inscreverAvisos(o: Ouvinte): () => void {
  ouvintes.add(o);
  o(lista);
  return () => ouvintes.delete(o);
}

export function fecharAviso(id: number): void {
  lista = lista.filter((a) => a.id !== id);
  emitir();
}

const DURACAO: Record<TomAviso, number> = { ok: 3500, info: 5000, erro: 0 };

/** Os alert() antigos não diziam o tom; o texto diz. */
export function inferirTom(texto: string): TomAviso {
  const t = texto.toLowerCase();
  if (/(erro|falh|não foi possível|não possui|insuficiente|inválid|não reconhecid)/.test(t)) return 'erro';
  if (/(sucesso|salv[oa]|carregad|conclu|pront[oa])/.test(t)) return 'ok';
  return 'info';
}

export function avisar(
  texto: string,
  opcoes: { tom?: TomAviso; acao?: Aviso['acao']; duracao?: number } = {},
): number {
  const tom = opcoes.tom ?? inferirTom(texto);
  // O mesmo texto repetido (ex.: erro em cada produto de um lote) não empilha.
  const igual = lista.find((a) => a.texto === texto && a.tom === tom);
  if (igual) {
    lista = [{ ...igual, id: proximoId++ }, ...lista.filter((a) => a !== igual)];
    emitir();
    return lista[0].id;
  }
  const aviso: Aviso = { id: proximoId++, tom, texto, acao: opcoes.acao, duracao: opcoes.duracao ?? DURACAO[tom] };
  lista = [aviso, ...lista].slice(0, MAX);
  emitir();
  return aviso.id;
}

avisar.ok = (texto: string, acao?: Aviso['acao']) => avisar(texto, { tom: 'ok', acao });
avisar.erro = (texto: string, acao?: Aviso['acao']) => avisar(texto, { tom: 'erro', acao });
avisar.info = (texto: string, acao?: Aviso['acao']) => avisar(texto, { tom: 'info', acao });
