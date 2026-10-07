// Confirmação em diálogo próprio — substituto do window.confirm(), que trava a
// página e não segue o tema. Promise<boolean>, então a troca nos chamadores é
// `if (!(await confirmar(...))) return;`.

export interface PedidoConfirmacao {
  id: number;
  texto: string;
  /** Rótulo do botão de confirmar. */
  confirmar: string;
  /** Ação destrutiva: o botão de confirmar fica vermelho. */
  perigo: boolean;
  responder: (ok: boolean) => void;
}

type Ouvinte = (p: PedidoConfirmacao | null) => void;

let atual: PedidoConfirmacao | null = null;
const fila: PedidoConfirmacao[] = [];
const ouvintes = new Set<Ouvinte>();
let proximoId = 1;

function emitir() {
  for (const o of ouvintes) o(atual);
}

export function inscreverConfirmacao(o: Ouvinte): () => void {
  ouvintes.add(o);
  o(atual);
  return () => ouvintes.delete(o);
}

const PERIGO = /\b(excluir|remover|apagar|regerar|descartar)\b/i;

export function confirmar(texto: string, opcoes: { confirmar?: string; perigo?: boolean } = {}): Promise<boolean> {
  // Sem o diálogo montado (ex.: tela fora do App), cai no nativo.
  if (!ouvintes.size) return Promise.resolve(window.confirm(texto));
  const perigo = opcoes.perigo ?? PERIGO.test(texto);
  return new Promise((resolve) => {
    const pedido: PedidoConfirmacao = {
      id: proximoId++,
      texto,
      confirmar: opcoes.confirmar ?? (perigo ? 'Confirmar' : 'Continuar'),
      perigo,
      responder: (ok) => {
        resolve(ok);
        atual = fila.shift() ?? null;
        emitir();
      },
    };
    if (atual) fila.push(pedido);
    else {
      atual = pedido;
      emitir();
    }
  });
}
