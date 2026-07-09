import { getAnalytics, logEvent, setUserId, Analytics } from 'firebase/analytics';
import { app } from './firebase';
import { metaTrack, metaSetUser } from './meta';

let analytics: Analytics | null = null;

function getAnalyticsInstance(): Analytics | null {
  if (analytics) return analytics;
  try {
    analytics = getAnalytics(app);
    return analytics;
  } catch {
    return null;
  }
}

export function analyticsSetUser(uid: string, email?: string | null) {
  const a = getAnalyticsInstance();
  if (a) setUserId(a, uid);
  metaSetUser(uid, email);
}

// 1. Registro / Login
export function trackLogin(method: string = 'google') {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'login', { method });
  metaTrack('Login', { method }, false);
}

export function trackSignUp(method: string = 'google') {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'sign_up', { method });
  metaTrack('CompleteRegistration', { method }, true);
}

// 2. Importação de Planilha
export function trackSpreadsheetImport(params: { product_count: number; category_count: number }) {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'spreadsheet_import', params);
  metaTrack('spreadsheet_import', params, false);
}

// 3. Geração de Descrição
export function trackDescriptionGenerated(params: { mode: 'single' | 'mass'; product_count?: number; sku?: string }) {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'description_generated', params);
  metaTrack('description_generated', params, false);
}

// 4. Geração de Imagem Ambientada
export function trackImageGenerated(params: { type: 'ambient' | 'regenerate'; sku?: string }) {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'image_generated', params);
  metaTrack('image_generated', params, false);
}

// 5. Geração de Atributos
export function trackAttributesGenerated(params: { source: 'text' | 'image'; sku?: string }) {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'attributes_generated', params);
  metaTrack('attributes_generated', params, false);
}

// 6. Exportar Planilha
export function trackSpreadsheetExport(params: { model: 'standard' | 'tinyerp'; product_count: number }) {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'spreadsheet_export', params);
  metaTrack('spreadsheet_export', params, false);
}

// 7. Adicionar Créditos (abertura do modal de compra)
export function trackCreditPurchaseOpen() {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'credit_purchase_open');
  metaTrack('InitiateCheckout', {}, true);
}

// 7b. Crédito comprado com sucesso
export function trackCreditPurchased(params: { amount: number; coupon?: string }) {
  const a = getAnalyticsInstance();
  if (a) {
    logEvent(a, 'purchase', {
      currency: 'BRL' as string,
      value: params.amount,
      coupon: params.coupon ?? '',
      transaction_id: `credits_${Date.now()}`,
      items: [],
    });
  }
  metaTrack('Purchase', { value: params.amount, currency: 'BRL', coupon: params.coupon ?? '' }, true);
}

// 8. Salvar Template de SEO
export function trackTemplateSaved(params: { is_new: boolean; template_name?: string }) {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'seo_template_saved', params);
  metaTrack('seo_template_saved', params, false);
}

// Extra: Enriquecimento de produto (GTIN/NCM)
export function trackProductEnriched(params: { mode: 'single' | 'mass'; product_count?: number }) {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'product_enriched', params);
  metaTrack('product_enriched', params, false);
}

// Extra: Hierarquia de categorias gerada
export function trackCategoryHierarchyGenerated(params: { category_count: number }) {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'category_hierarchy_generated', params);
  metaTrack('category_hierarchy_generated', params, false);
}

// Extra: Download da planilha padrão
export function trackTemplateDownloaded() {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'template_downloaded');
  metaTrack('template_downloaded', {}, false);
}
