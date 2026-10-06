// Ponte entre o site e a Tela 0 do onboarding (`ObjetivosPicker`): cada página
// de conversão manda para `/entrar?objetivo=X`, a tela de login guarda o X e,
// depois do cadastro, o picker já abre com ele marcado. Só sugere — quem
// escolhe continua sendo o cliente.

import type { Objetivo } from '../modules/agent/capacidades';

const CHAVE = 'alfreds:objetivo-site';
const VALIDOS: readonly Objetivo[] = ['produto', 'meli', 'conteudo'];

export function objetivoValido(v: unknown): Objetivo | null {
  return typeof v === 'string' && (VALIDOS as readonly string[]).includes(v) ? (v as Objetivo) : null;
}

/** Link de cadastro do site, com o objetivo da página quando houver. */
export function linkCadastro(objetivo?: Objetivo): string {
  return objetivo ? `/entrar?modo=criar&objetivo=${objetivo}` : '/entrar?modo=criar';
}

export function guardarObjetivoDoSite(o: Objetivo): void {
  try {
    localStorage.setItem(CHAVE, o);
  } catch {
    /* armazenamento bloqueado: o picker só abre sem pré-seleção */
  }
}

export function lerObjetivoDoSite(): Objetivo | null {
  try {
    return objetivoValido(localStorage.getItem(CHAVE));
  } catch {
    return null;
  }
}
