import { getAnalytics, logEvent, setUserId, Analytics } from 'firebase/analytics';
import { app } from './firebase';

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

export function analyticsSetUser(uid: string) {
  const a = getAnalyticsInstance();
  if (!a) return;
  setUserId(a, uid);
}

// 1. Registro / Login
export function trackLogin(method: string = 'google') {
  const a = getAnalyticsInstance();
  if (!a) return;
  logEvent(a, 'login', { method });
}

export function trackSignUp(method: string = 'google') {
  const a = getAnalyticsInstance();
  if (!a) return;
  logEvent(a, 'sign_up', { method });
}

// 2. Importação de Planilha
export function trackSpreadsheetImport(params: { product_count: number; category_count: number }) {
  const a = getAnalyticsInstance();
  if (!a) return;
  logEvent(a, 'spreadsheet_import', params);
}

// 3. Geração de Descrição
export function trackDescriptionGenerated(params: { mode: 'single' | 'mass'; product_count?: number; sku?: string }) {
  const a = getAnalyticsInstance();
  if (!a) return;
  logEvent(a, 'description_generated', params);
}

// 4. Geração de Imagem Ambientada
export function trackImageGenerated(params: { type: 'ambient' | 'regenerate'; sku?: string }) {
  const a = getAnalyticsInstance();
  if (!a) return;
  logEvent(a, 'image_generated', params);
}

// 5. Geração de Atributos
export function trackAttributesGenerated(params: { source: 'text' | 'image'; sku?: string }) {
  const a = getAnalyticsInstance();
  if (!a) return;
  logEvent(a, 'attributes_generated', params);
}

// 6. Exportar Planilha
export function trackSpreadsheetExport(params: { model: 'standard' | 'tinyerp'; product_count: number }) {
  const a = getAnalyticsInstance();
  if (!a) return;
  logEvent(a, 'spreadsheet_export', params);
}

// 7. Adicionar Créditos (abertura do modal de compra)
export function trackCreditPurchaseOpen() {
  const a = getAnalyticsInstance();
  if (!a) return;
  logEvent(a, 'credit_purchase_open');
}

// 7b. Crédito comprado com sucesso
export function trackCreditPurchased(params: { amount: number; coupon?: string }) {
  const a = getAnalyticsInstance();
  if (!a) return;
  logEvent(a, 'purchase', {
    currency: 'BRL' as string,
    value: params.amount,
    coupon: params.coupon ?? '',
    transaction_id: `credits_${Date.now()}`,
    items: [],
  });
}

// 8. Salvar Template de SEO
export function trackTemplateSaved(params: { is_new: boolean; template_name?: string }) {
  const a = getAnalyticsInstance();
  if (!a) return;
  logEvent(a, 'seo_template_saved', params);
}

// Extra: Enriquecimento de produto (GTIN/NCM)
export function trackProductEnriched(params: { mode: 'single' | 'mass'; product_count?: number }) {
  const a = getAnalyticsInstance();
  if (!a) return;
  logEvent(a, 'product_enriched', params);
}

// Extra: Hierarquia de categorias gerada
export function trackCategoryHierarchyGenerated(params: { category_count: number }) {
  const a = getAnalyticsInstance();
  if (!a) return;
  logEvent(a, 'category_hierarchy_generated', params);
}

// Extra: Download da planilha padrão
export function trackTemplateDownloaded() {
  const a = getAnalyticsInstance();
  if (!a) return;
  logEvent(a, 'template_downloaded');
}
