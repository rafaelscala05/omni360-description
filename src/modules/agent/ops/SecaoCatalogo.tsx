import React, { useEffect, useState } from 'react';
import type { PainelCatalogo, PainelPrecos } from './catalogo';
import { MARGEM_BAIXA } from './catalogo';
import { Aviso, BotaoAlfred, LinhaItem, Secao, Tile, brl, int } from './pecas';

interface Linha { chave: string; titulo: string; sub: string; valor: string; alerta?: boolean }

interface Detalhe {
  chave: string;
  rotulo: string;
  total: number;
  sub: string;
  alerta: boolean;
  linhas: Linha[];
  /** Pedido ao Alfred com os SKUs da lista; sem pedido, o detalhe só informa. */
  pedido?: string;
  acao?: string;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const skus = (linhas: Linha[], fmt: (l: Linha) => string) => linhas.slice(0, 15).map(fmt).join('; ');

/** Tiles que abrem a lista embaixo; o primeiro com pendência já vem aberto. */
const Seletor: React.FC<{ detalhes: Detalhe[]; vazio: string; onPedirAlfred: (t: string) => void }> = ({ detalhes, vazio, onPedirAlfred }) => {
  const inicial = detalhes.find((d) => d.alerta && d.total > 0)?.chave ?? null;
  const [aberto, setAberto] = useState<string | null>(inicial);
  // Os números chegam depois da primeira pintura (o sync ainda está lendo): abre quando a primeira pendência aparece.
  useEffect(() => { if (aberto === null && inicial) setAberto(inicial); }, [inicial]); // eslint-disable-line react-hooks/exhaustive-deps
  const d = detalhes.find((x) => x.chave === aberto) ?? null;
  return (
    <>
      <div className={`grid grid-cols-2 ${detalhes.length >= 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'} gap-3`}>
        {detalhes.map((x) => (
          <Tile
            key={x.chave}
            rotulo={x.rotulo}
            valor={int(x.total)}
            alerta={x.alerta && x.total > 0}
            ativo={aberto === x.chave}
            onClick={() => setAberto(aberto === x.chave ? null : x.chave)}
          >
            <span className="text-[12px] text-[var(--ag-text-3)]">{x.sub}</span>
          </Tile>
        ))}
      </div>
      {d && (
        d.total === 0 ? (
          <p className="px-1 text-[13px] text-[var(--ag-text-3)]">{vazio}</p>
        ) : (
          <div className="ag-glass rounded-[18px] overflow-hidden">
            <div className="flex items-center gap-3 px-4 pt-3 pb-1">
              <span className="flex-1 min-w-0 text-[12.5px] font-medium text-[var(--ag-text-2)] truncate">
                {d.rotulo}{d.total > d.linhas.length ? ` · ${int(d.linhas.length)} de ${int(d.total)}` : ''}
              </span>
              {d.pedido && <BotaoAlfred onClick={() => onPedirAlfred(d.pedido as string)}>{d.acao}</BotaoAlfred>}
            </div>
            <ul>
              {d.linhas.slice(0, 8).map((l, i) => (
                <LinhaItem key={l.chave} primeira={i === 0} titulo={l.titulo} sub={l.sub} valor={l.valor} tom={l.alerta ? 'warn' : undefined} />
              ))}
            </ul>
          </div>
        )
      )}
    </>
  );
};

/**
 * Catálogo ERP × loja: o que não está à venda e deveria, o que está na loja
 * sem existir no ERP e onde o estoque diverge. Sem ERP conectado, só o que dá
 * para ver da loja sozinha.
 */
export const SecaoCatalogo: React.FC<{
  catalogo: PainelCatalogo;
  nomeErp: string | null;
  carregando: string | null;
  onPedirAlfred: (t: string) => void;
  onAbrirFontes: () => void;
}> = ({ catalogo: c, nomeErp, carregando, onPedirAlfred, onAbrirFontes }) => {
  const erp = nomeErp ?? 'ERP';
  const detalhes: Detalhe[] = [];
  if (c.comparado) {
    const fora = c.foraDaLoja.itens.map((i) => ({ chave: i.sku, titulo: i.nome, sub: i.sku, valor: i.estoque ? `${int(i.estoque)} un` : 'sem estoque', alerta: (i.estoque ?? 0) > 0 }));
    detalhes.push({
      chave: 'fora-loja', rotulo: `No ${erp}, fora da loja`, total: c.foraDaLoja.total, alerta: c.foraDaLoja.comEstoque > 0,
      sub: `${int(c.foraDaLoja.comEstoque)} com estoque — venda perdida`, linhas: fora, acao: 'Publicar',
      pedido: `Estes produtos estão no ${erp} mas não existem na loja Wake: ${skus(fora, (l) => `${l.sub} (${l.valor})`)}. Me ajude a publicá-los na Wake, começando pelos que têm estoque.`,
    });
  }
  const ocultos = c.ocultosComEstoque.itens.map((i) => ({ chave: i.sku, titulo: i.nome, sub: i.sku, valor: `${int(i.estoque ?? 0)} un`, alerta: true }));
  detalhes.push({
    chave: 'ocultos', rotulo: 'Ocultos com estoque', total: c.ocultosComEstoque.total, alerta: true,
    sub: 'na loja, mas fora da vitrine', linhas: ocultos, acao: 'Reexibir',
    pedido: `Estes produtos estão ocultos ou inválidos na Wake, mas têm estoque: ${skus(ocultos, (l) => `${l.sub} (${l.valor})`)}. Verifique por que estão fora da vitrine e proponha reexibi-los.`,
  });
  if (c.comparado) {
    const dif = c.estoqueDiferente.itens.map((i) => ({ chave: i.sku, titulo: i.nome, sub: `${i.sku} · ${erp} ${int(i.erp)} · loja ${int(i.loja)}`, valor: `${i.loja - i.erp > 0 ? '+' : ''}${int(i.loja - i.erp)}`, alerta: true }));
    detalhes.push({
      chave: 'estoque', rotulo: 'Estoque diferente', total: c.estoqueDiferente.total, alerta: true,
      sub: `entre o ${erp} e a loja`, linhas: dif, acao: 'Acertar estoque',
      pedido: `O estoque destes produtos está diferente entre o ${erp} e a Wake: ${skus(dif, (l) => l.sub)}. O ${erp} é a referência: proponha ajustar o estoque na Wake.`,
    });
    const soLoja = c.foraDoErp.itens.map((i) => ({ chave: i.sku, titulo: i.nome, sub: i.sku, valor: i.estoque != null ? `${int(i.estoque)} un` : '—' }));
    detalhes.push({ chave: 'fora-erp', rotulo: `Na loja, fora do ${erp}`, total: c.foraDoErp.total, alerta: false, sub: 'sem cadastro no ERP', linhas: soLoja });
  }

  return (
    <Secao
      titulo="Catálogo"
      nota={c.comparado
        ? `${int(c.totalErp)} itens no ${erp} · ${int(c.totalLoja)} na loja · ${int(c.emAmbos)} nos dois. Comparado pela SKU.`
        : `${int(c.totalLoja)} itens na loja.`}
    >
      {carregando && <p className="px-1 -mt-1 text-[12.5px] text-[var(--ag-text-3)]">{carregando}</p>}
      {!c.comparado && (
        <Aviso titulo="Conecte o ERP para comparar" texto="Com o ERP conectado, o painel mostra o que está no ERP e falta na loja, e onde o estoque diverge." acao={{ rotulo: 'Conectar', onClick: onAbrirFontes }} />
      )}
      <Seletor detalhes={detalhes} vazio="Nada aqui." onPedirAlfred={onPedirAlfred} />
    </Secao>
  );
};

/** Preços: ERP × loja, à venda sem preço, promoções e margem. */
export const SecaoPrecos: React.FC<{ precos: PainelPrecos; nomeErp: string | null; onPedirAlfred: (t: string) => void }> = ({ precos: p, nomeErp, onPedirAlfred }) => {
  const erp = nomeErp ?? 'ERP';
  const detalhes: Detalhe[] = [];
  if (p.comparado) {
    const dif = p.precoDiferente.itens.map((i) => ({ chave: i.sku, titulo: i.nome, sub: `${i.sku} · ${erp} ${brl(i.erp)} · loja ${brl(i.loja)}`, valor: `${i.loja > i.erp ? '+' : ''}${pct((i.loja - i.erp) / i.erp)}`, alerta: true }));
    detalhes.push({
      chave: 'diferente', rotulo: `Preço diferente do ${erp}`, total: p.precoDiferente.total, alerta: true,
      sub: 'preço final na loja × no ERP', linhas: dif, acao: 'Acertar preços',
      pedido: `O preço final destes produtos na Wake está diferente do ${erp}: ${skus(dif, (l) => l.sub)}. Confirme qual está certo e proponha ajustar os preços na Wake.`,
    });
  }
  const baixo = [...p.abaixoDoCusto.itens, ...p.margemBaixa.itens].map((i) => ({
    chave: i.sku, titulo: i.nome, sub: `${i.sku} · ${brl(i.preco)} · custo ${brl(i.custo)}`, valor: pct(i.margem), alerta: i.margem < 0,
  }));
  detalhes.push({
    chave: 'margem', rotulo: 'Abaixo do custo', total: p.abaixoDoCusto.total, alerta: true,
    sub: p.margemBaixa.total ? `+ ${int(p.margemBaixa.total)} com margem < ${pct(MARGEM_BAIXA)}` : `nenhum com margem < ${pct(MARGEM_BAIXA)}`, linhas: baixo, acao: 'Rever preços',
    pedido: `Estes produtos estão à venda na Wake abaixo do custo ou com margem abaixo de ${pct(MARGEM_BAIXA)}: ${skus(baixo, (l) => `${l.sub} (margem ${l.valor})`)}. Proponha novos preços.`,
  });
  const promos = p.promocoes.itens.map((i) => ({ chave: i.sku, titulo: i.nome, sub: `${i.sku} · de ${brl(i.de)} por ${brl(i.por)}`, valor: `−${pct(i.desconto)}` }));
  detalhes.push({
    chave: 'promo', rotulo: 'Em promoção', total: p.promocoes.total, alerta: false,
    sub: p.promocoes.descontoMedio !== null ? `desconto médio de ${pct(p.promocoes.descontoMedio)}` : 'nenhuma ativa', linhas: promos, acao: 'Revisar',
    pedido: `Estas são as promoções ativas na Wake: ${skus(promos, (l) => `${l.sub}`)}. Revise se ainda fazem sentido e se alguma vende abaixo do custo.`,
  });
  if (p.semPrecoNaLoja.total > 0) {
    const sem = p.semPrecoNaLoja.itens.map((i) => ({ chave: i.sku, titulo: i.nome, sub: i.sku, valor: 'R$ 0', alerta: true }));
    detalhes.push({
      chave: 'sem-preco', rotulo: 'À venda sem preço', total: p.semPrecoNaLoja.total, alerta: true, sub: 'visíveis na vitrine', linhas: sem, acao: 'Corrigir',
      pedido: `Estes produtos estão visíveis na Wake sem preço: ${skus(sem, (l) => l.sub)}. Busque o preço no ${erp} e proponha cadastrar na Wake.`,
    });
  }

  return (
    <Secao
      titulo="Preços"
      nota={p.comCusto > 0
        ? `Margem calculada em ${pct(p.comCusto)} dos itens à venda — os que têm custo na Wake ou no ${erp}.`
        : `Nenhum item à venda tem custo cadastrado na Wake ou no ${erp}: a margem fica de fora.`}
    >
      <Seletor detalhes={detalhes} vazio="Nada aqui." onPedirAlfred={onPedirAlfred} />
    </Secao>
  );
};
