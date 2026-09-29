import type {
  MeliAnalysisFinding,
  MeliChecklistItem,
  MeliImageDiagnostic,
  MeliListingRecord,
  MeliMediaSummary,
} from './types';

// O Mercado Livre só oferece zoom a partir de 1200 px no menor lado; abaixo
// de 500 px a foto nem é aceita.
export const ZOOM_MIN_SIDE = 1200;
export const RECOMMENDED_PICTURE_COUNT = 5;
const SHORT_TITLE = 40;

function pictureCount(listing: Pick<MeliListingRecord, 'pictures'>): number {
  return Array.isArray(listing.pictures) ? listing.pictures.length : 0;
}

export function buildMediaSummary(
  listing: Pick<MeliListingRecord, 'pictures' | 'videoId'>,
  diagnostics: MeliImageDiagnostic[],
): MeliMediaSummary {
  const byRole = (role: string) => diagnostics.filter((image) => image.role === role).length;
  const main = diagnostics.find((image) => image.order === 0);
  const mainWhiteBackground = main
    ? main.whiteBackground ?? (main.role === 'main_white_background' ? true : main.role ? false : null)
    : null;
  return {
    pictureCount: pictureCount(listing),
    mainWhiteBackground,
    lifestyleCount: byRole('lifestyle'),
    detailCount: byRole('detail'),
    dimensionsCount: byRole('dimensions') + byRole('infographic'),
    zoomReadyCount: diagnostics.filter((image) => image.width && image.height && Math.min(image.width, image.height) >= ZOOM_MIN_SIDE).length,
    hasVideo: Boolean(listing.videoId),
    videoId: listing.videoId || null,
  };
}

function has(findings: MeliAnalysisFinding[], predicate: (finding: MeliAnalysisFinding) => boolean): boolean {
  return findings.some(predicate);
}

// Checklist em linguagem de vendedor: o que ajuda o anúncio a ganhar
// relevância. Derivado dos achados + resumo de mídia, sem chamada extra.
export function buildChecklist(
  listing: Pick<MeliListingRecord, 'title' | 'descriptionPlainText' | 'pictures' | 'videoId'>,
  findings: MeliAnalysisFinding[],
  media: MeliMediaSummary,
): MeliChecklistItem[] {
  const items: MeliChecklistItem[] = [];
  const attributeFindings = findings.filter((finding) => finding.fieldPath.startsWith('attributes.'));
  const requiredMissing = attributeFindings.filter((finding) => finding.code === 'REQUIRED_ATTRIBUTE_MISSING').length;
  items.push({
    id: 'attributes', label: 'Ficha técnica completa',
    status: requiredMissing ? 'missing' : attributeFindings.some((finding) => finding.severity !== 'info') ? 'warning' : 'ok',
    detail: requiredMissing
      ? `${requiredMissing} atributo(s) obrigatório(s) sem valor. A ficha completa é o que coloca o anúncio nos filtros de busca.`
      : attributeFindings.length ? `${attributeFindings.length} atributo(s) para completar ou corrigir.` : 'Todos os atributos importantes estão preenchidos.',
  });

  const titleIssue = has(findings, (finding) => finding.fieldPath === 'title' && ['medium', 'high', 'blocked'].includes(finding.severity));
  const title = listing.title.trim();
  items.push({
    id: 'title', label: 'Título com as palavras que o comprador busca',
    status: !title ? 'missing' : titleIssue || title.length < SHORT_TITLE ? 'warning' : 'ok',
    detail: !title ? 'O anúncio está sem título.'
      : titleIssue ? 'O título tem termos promocionais ou símbolos que atrapalham a busca.'
        : title.length < SHORT_TITLE ? `O título tem ${title.length} caracteres; use produto, marca, modelo e a principal característica.`
          : 'Título objetivo e completo.',
  });

  const description = listing.descriptionPlainText.trim();
  const descriptionIssue = has(findings, (finding) => finding.fieldPath.startsWith('description') && finding.code !== 'DESCRIPTION_EMPTY');
  items.push({
    id: 'description', label: 'Descrição que responde às dúvidas',
    status: !description ? 'missing' : descriptionIssue ? 'warning' : 'ok',
    detail: !description ? 'O anúncio não tem descrição.'
      : descriptionIssue ? 'A descrição está curta ou tem HTML, links ou contato.' : 'Descrição presente e em texto simples.',
  });

  items.push({
    id: 'main_picture', label: 'Foto principal com fundo branco',
    status: !media.pictureCount ? 'missing' : media.mainWhiteBackground === true ? 'ok' : 'warning',
    detail: !media.pictureCount ? 'O anúncio não tem fotos.'
      : media.mainWhiteBackground === true ? 'A primeira foto está em fundo branco.'
        : media.mainWhiteBackground === false ? 'A primeira foto não está em fundo branco — é a que aparece na busca.'
          : 'Não foi possível verificar o fundo da primeira foto.',
  });

  items.push({
    id: 'lifestyle_picture', label: 'Foto ambientada (produto em uso)',
    status: media.lifestyleCount ? 'ok' : 'missing',
    detail: media.lifestyleCount ? `${media.lifestyleCount} foto(s) ambientada(s).` : 'Nenhuma foto mostra o produto em uso ou num ambiente real.',
  });

  const detailTotal = media.detailCount + media.dimensionsCount;
  items.push({
    id: 'detail_picture', label: 'Fotos de detalhe ou medidas',
    status: detailTotal ? 'ok' : 'warning',
    detail: detailTotal ? `${detailTotal} foto(s) de detalhe, medidas ou informações.` : 'Nenhuma foto mostra detalhes, acabamento ou medidas.',
  });

  const lowRes = media.pictureCount - media.zoomReadyCount;
  const few = media.pictureCount < RECOMMENDED_PICTURE_COUNT;
  items.push({
    id: 'picture_quality', label: 'Quantidade e qualidade das fotos',
    status: !media.pictureCount ? 'missing' : few || lowRes > 0 ? 'warning' : 'ok',
    detail: [
      few ? `${media.pictureCount} foto(s); o recomendado é pelo menos ${RECOMMENDED_PICTURE_COUNT}.` : `${media.pictureCount} fotos.`,
      lowRes > 0 ? `${lowRes} abaixo de ${ZOOM_MIN_SIDE} px, sem zoom.` : 'Todas com resolução para zoom.',
    ].join(' '),
  });

  items.push({
    id: 'video', label: 'Vídeo do produto',
    status: media.hasVideo ? 'ok' : 'missing',
    detail: media.hasVideo ? 'O anúncio tem vídeo cadastrado.' : 'O anúncio não tem vídeo — vídeo aumenta a confiança de quem compra.',
  });
  return items;
}
