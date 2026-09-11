// Número de WhatsApp brasileiro: normalização, validação e o formato mascarado
// que o wizard legado grava — a automação do CRM lê o mesmo campo, então os
// dois caminhos precisam produzir a mesma forma. Puro: usado no cliente e no
// servidor.

export function normalizarWhatsapp(raw: string): string {
  let d = String(raw ?? '').replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  return d;
}

/** DDD + número: 10 dígitos (fixo) ou 11 (celular). */
export function whatsappValido(digitos: string): boolean {
  return /^\d{10,11}$/.test(digitos);
}

export function formatarWhatsapp(digitos: string): string {
  const d = digitos.slice(0, 11);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}
