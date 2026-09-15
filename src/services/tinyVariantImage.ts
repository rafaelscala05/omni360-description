// Imagem que um produto leva para o Tiny no urlImagem do mapeamento (usada só
// quando o Tiny diz que o item é variação). Pura — sem I/O — para ser verificada
// em scripts/verify-tiny-push.mjs.
import type { Product } from '../types/models';

type ComImagem = Pick<Product, '_selectedImage' | 'URL imagem 1' | 'Código do pai'>;

// Imagem principal: a escolhida no omni360, senão a primeira importada. Só vale
// URL pública http(s) — o Tiny baixa a imagem; data: e blob: não servem.
function imagemPrincipal(p?: ComImagem): string | undefined {
  const url = p?._selectedImage || p?.['URL imagem 1'];
  return typeof url === 'string' && /^https?:\/\//i.test(url) ? url : undefined;
}

// Variante sem imagem própria fica sem imagem. Uma imagem idêntica à principal
// do pai é tratada como herdada: é o que sobrou da antiga propagação pai→filhos
// em handleSaveImages, e mandá-la gravaria a foto do pai na variação.
export function urlImagemPropria(produto: ComImagem, pai?: ComImagem): string | undefined {
  const url = imagemPrincipal(produto);
  if (!url) return undefined;
  if (produto['Código do pai'] && imagemPrincipal(pai) === url) return undefined;
  return url;
}
