import { getAnalytics, logEvent, setUserId, Analytics } from 'firebase/analytics';
import { app, auth } from './firebase';
import { metaTrack, metaSetUser, metaSetProfile } from './meta';

export { metaSetProfile };
import { tiktokTrack, tiktokSetUser } from './tiktok';

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

// Quarto sink, ao lado de GA4/Meta/TikTok: persiste o evento no CRM interno
// (server/crmEvents.ts), que é o que alimenta a jornada de ativação em /admin.
// GA4/Meta/TikTok servem para otimizar anúncios e não são consultáveis para
// operar a base — daí o registro próprio.
//
// Nunca derruba o fluxo do produto: qualquer falha aqui é só logada.
function crmTrack(name: string, props: Record<string, unknown> = {}): void {
  void (async () => {
    try {
      const user = auth.currentUser;
      if (!user) return;
      const token = await user.getIdToken();
      await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name, props }),
      });
    } catch (err) {
      console.warn('crm track falhou', err);
    }
  })();
}

export function analyticsSetUser(uid: string, email?: string | null, displayName?: string | null) {
  const a = getAnalyticsInstance();
  if (a) setUserId(a, uid);
  metaSetUser(uid, email, displayName);
  tiktokSetUser(uid, email);
}

// 1. Registro / Login
export function trackLogin(method: string = 'google') {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'login', { method });
  metaTrack('Login', { method }, false);
  tiktokTrack('Login', { method });
  crmTrack('login', { method });
}

export function trackSignUp(method: string = 'google') {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'sign_up', { method });
  // value/currency são exigidos pelo Meta para calcular ROAS em cima do
  // CompleteRegistration — não é um valor cobrado de verdade, é o sinal
  // mínimo (> 0) que o Meta pede para o evento contar em otimização de valor.
  metaTrack('CompleteRegistration', { method, value: 1, currency: 'BRL' }, true);
  tiktokTrack('CompleteRegistration', { method });
}

// 2. Importação de Planilha
export function trackSpreadsheetImport(params: { product_count: number; category_count: number }) {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'spreadsheet_import', params);
  metaTrack('spreadsheet_import', params, false);
  tiktokTrack('spreadsheet_import', params);
  crmTrack('spreadsheet_import', params);
}

// 3. Geração de Descrição
export function trackDescriptionGenerated(params: { mode: 'single' | 'mass'; product_count?: number; sku?: string }) {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'description_generated', params);
  metaTrack('description_generated', params, false);
  tiktokTrack('description_generated', params);
  crmTrack('description_generated', params);
}

// 4. Geração de Imagem Ambientada
export function trackImageGenerated(params: { type: 'ambient' | 'regenerate'; sku?: string }) {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'image_generated', params);
  metaTrack('image_generated', params, false);
  tiktokTrack('image_generated', params);
  crmTrack('image_generated', params);
}

// 5. Geração de Atributos
export function trackAttributesGenerated(params: { source: 'text' | 'image'; sku?: string }) {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'attributes_generated', params);
  metaTrack('attributes_generated', params, false);
  tiktokTrack('attributes_generated', params);
  crmTrack('attributes_generated', params);
}

// 6. Exportar Planilha
export function trackSpreadsheetExport(params: { model: 'standard' | 'tinyerp'; product_count: number }) {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'spreadsheet_export', params);
  metaTrack('spreadsheet_export', params, false);
  tiktokTrack('spreadsheet_export', params);
  crmTrack('spreadsheet_export', params);
}

// 7. Adicionar Créditos (abertura do modal de compra)
export function trackCreditPurchaseOpen() {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'credit_purchase_open');
  metaTrack('InitiateCheckout', {}, true);
  tiktokTrack('InitiateCheckout', {});
  crmTrack('credit_purchase_open');
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
  // TikTok não tem um evento "Purchase" padrão — o equivalente do catálogo de
  // eventos é CompletePayment.
  tiktokTrack('CompletePayment', { value: params.amount, currency: 'BRL', coupon: params.coupon ?? '' });
}

// 8. Salvar Template de SEO
export function trackTemplateSaved(params: { is_new: boolean; template_name?: string }) {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'seo_template_saved', params);
  metaTrack('seo_template_saved', params, false);
  tiktokTrack('seo_template_saved', params);
  crmTrack('seo_template_saved', params);
}

// Extra: Enriquecimento de produto (GTIN/NCM)
export function trackProductEnriched(params: { mode: 'single' | 'mass'; product_count?: number }) {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'product_enriched', params);
  metaTrack('product_enriched', params, false);
  tiktokTrack('product_enriched', params);
  crmTrack('product_enriched', params);
}

// Extra: Hierarquia de categorias gerada
export function trackCategoryHierarchyGenerated(params: { category_count: number }) {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'category_hierarchy_generated', params);
  metaTrack('category_hierarchy_generated', params, false);
  tiktokTrack('category_hierarchy_generated', params);
  crmTrack('category_hierarchy_generated', params);
}

// Extra: Download da planilha padrão
export function trackTemplateDownloaded() {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'template_downloaded');
  metaTrack('template_downloaded', {}, false);
  tiktokTrack('template_downloaded', {});
  crmTrack('template_downloaded');
}

// Extra: Onboarding de primeiro produto via URL
export function trackProductUrlImportStarted() {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'product_url_import_started');
  crmTrack('product_url_import_started');
}

export function trackProductUrlImportResult(params: { source: 'structured' | 'hybrid' | 'ai' | 'failed' | 'manual' }) {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'product_url_import_result', params);
  crmTrack('product_url_import_result', params);
}

export function trackOnboardingStepCompleted(params: { step: 'description' | 'attributes' | 'image'; skipped: boolean }) {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'onboarding_step_completed', params);
  crmTrack('onboarding_step_completed', params);
}

// Marketing (site público, fora do app autenticado)

// Clique em CTA de marketing (Hero, FinalCTA, nav) — sinal de topo/meio de
// funil para o TikTok aprender engajamento antes da conversão completa.
export function trackMarketingCtaClick(params: { label: string; destination: string }) {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'marketing_cta_click', params);
  metaTrack('marketing_cta_click', params, false);
  tiktokTrack('ClickButton', {
    contents: [{ content_id: params.destination, content_type: 'product', content_name: params.label }],
  });
}

// Visualização da página de preços
export function trackPricingViewed() {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'view_pricing');
  metaTrack('ViewContent', { content_name: 'pricing' }, true);
  tiktokTrack('ViewContent', {
    contents: [{ content_id: 'pricing', content_type: 'product_group', content_name: 'Preços' }],
  });
}

// Envio do formulário de contato ("Falar com especialista")
export function trackContactLead() {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'generate_lead');
  metaTrack('Lead', {}, true);
  tiktokTrack('Lead', {
    contents: [{ content_id: 'contact_form', content_type: 'product', content_name: 'Falar com especialista' }],
  });
}
