import React from 'react';

// Renderizador de um subconjunto de Markdown em elementos React.
//
// Deliberadamente NÃO usa markdownToHtml + dangerouslySetInnerHTML como o módulo
// de conteúdo: aqui a resposta do modelo ecoa dados vindos da Wake e do Tiny
// (nome de produto, texto de banner), e um `<img onerror=…>` cadastrado na loja
// viraria XSS na sessão de quem abriu o chat. Gerando nós React, não existe
// caminho de string para HTML.

const inline = (texto: string, chave: string): React.ReactNode[] => {
  const nos: React.ReactNode[] = [];
  // **negrito** | `código` | *itálico*
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*)/g;
  let ultimo = 0;
  let m: RegExpExecArray | null;
  let i = 0;

  while ((m = re.exec(texto)) !== null) {
    if (m.index > ultimo) nos.push(texto.slice(ultimo, m.index));
    const t = m[0];
    if (t.startsWith('**')) nos.push(<strong key={`${chave}-b${i}`}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith('`')) {
      nos.push(
        <code key={`${chave}-c${i}`} className="px-1.5 py-0.5 rounded bg-slate-100 text-[0.9em] font-mono text-slate-700">
          {t.slice(1, -1)}
        </code>,
      );
    } else nos.push(<em key={`${chave}-i${i}`}>{t.slice(1, -1)}</em>);
    ultimo = m.index + t.length;
    i++;
  }
  if (ultimo < texto.length) nos.push(texto.slice(ultimo));
  return nos;
};

const Markdown: React.FC<{ texto: string }> = ({ texto }) => {
  const blocos: React.ReactNode[] = [];
  const linhas = texto.split('\n');
  let lista: string[] = [];

  const fecharLista = (chave: string) => {
    if (!lista.length) return;
    blocos.push(
      <ul key={`ul-${chave}`} className="list-disc pl-5 space-y-1 my-2">
        {lista.map((item, i) => <li key={i}>{inline(item, `${chave}-${i}`)}</li>)}
      </ul>,
    );
    lista = [];
  };

  linhas.forEach((linha, i) => {
    const item = linha.match(/^\s*[-*]\s+(.*)$/);
    if (item) { lista.push(item[1]); return; }
    fecharLista(String(i));

    const titulo = linha.match(/^(#{1,3})\s+(.*)$/);
    if (titulo) {
      blocos.push(
        <div key={i} className="font-semibold text-slate-900 mt-3 mb-1">{inline(titulo[2], `h${i}`)}</div>,
      );
      return;
    }
    if (!linha.trim()) return;
    blocos.push(<p key={i} className="my-1.5">{inline(linha, `p${i}`)}</p>);
  });
  fecharLista('fim');

  return <div className="text-[15px] leading-relaxed text-slate-800">{blocos}</div>;
};

export default Markdown;
