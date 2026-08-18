// Tipos do CRM admin, compartilhados entre client (src/modules/admin) e
// servidor (server/crm*.ts). Sem I/O e sem imports de firebase, para poder ser
// importado dos dois lados.

export const CRM_STAGES = [
  'signed_up',
  'products_uploaded',
  'content_generated',
  'integrated_or_exported',
  'active',
] as const;
export type CrmStage = (typeof CRM_STAGES)[number];

export const STAGE_LABELS: Record<CrmStage, string> = {
  signed_up: 'Cadastrou',
  products_uploaded: 'Subiu Produtos',
  content_generated: 'Gerou Descrição ou Imagem',
  integrated_or_exported: 'Integrou ou Exportou',
  active: 'Ativo / Recorrente',
};

export const PIPELINE_STATUSES = ['novo', 'em_contato', 'qualificado', 'ganho', 'perdido'] as const;
export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

export const PIPELINE_LABELS: Record<PipelineStatus, string> = {
  novo: 'Novo',
  em_contato: 'Em contato',
  qualificado: 'Qualificado',
  ganho: 'Ganho',
  perdido: 'Perdido',
};

export type HealthBand = 'ativo' | 'atencao' | 'risco' | 'inativo';

export const HEALTH_BAND_LABELS: Record<HealthBand, string> = {
  ativo: 'Ativo',
  atencao: 'Atenção',
  risco: 'Risco',
  inativo: 'Inativo',
};

// Dias parado no mesmo estágio antes de o cliente ser considerado estagnado.
// Varia por estágio: 3 dias em "Cadastrou" é grave, 14 em "Integrou" é normal.
//
// 'active' é TERMINAL — não há para onde avançar, então "tempo parado" ali não
// significa nada. Um cliente recorrente esfriando aparece pelo health score
// (que é dirigido por recência), não pela estagnação. Sem esta exceção, seus
// melhores clientes seriam listados como precisando de resgate.
export const STAGNATION_DAYS: Record<CrmStage, number> = {
  signed_up: 3,
  products_uploaded: 5,
  content_generated: 7,
  integrated_or_exported: 14,
  active: Infinity,
};

export interface CrmCounters {
  products: number;
  descriptions: number;
  images: number;
  exports: number;
  erpSyncs: number;
  aiOps30d: number;
}

export interface CrmSummary {
  stage: CrmStage;
  stageEnteredAt: string;
  firstSeenAt: string;
  lastSeenAt: string;
  milestones: Partial<Record<CrmStage, string>>;
  counters: CrmCounters;
  activeWeeks: string[];
  healthScore: number;
  healthBand: HealthBand;
  pipelineStatus: PipelineStatus;
  pipelineUpdatedAt: string | null;
  pipelineUpdatedBy: string | null;
  tags: string[];
  // Bloqueia todo envio automático de WhatsApp. Respeitar isso é exigência da
  // política da Meta, não só cortesia.
  whatsappOptOut?: boolean;
  updatedAt: string;
}

export type CrmEventSource = 'server' | 'client' | 'derived';

export interface CrmEvent {
  id: string;
  name: string;
  ts: string;
  source: CrmEventSource;
  props: Record<string, unknown>;
}

export interface CrmNote {
  id: string;
  body: string;
  createdAt: string;
  createdBy: string;
  createdByName: string;
}

export interface CrmTask {
  id: string;
  uid: string;
  customerName: string;
  title: string;
  dueDate: string;
  done: boolean;
  doneAt: string | null;
  createdAt: string;
  createdBy: string;
}

export interface CrmAudit {
  id: string;
  uid: string;
  action: string;
  detail: string;
  at: string;
  by: string;
  byName: string;
}

export interface CustomerListItem {
  uid: string;
  displayName: string;
  email: string;
  companyName: string;
  whatsapp: string;
  credits: number;
  crm: CrmSummary | null;
  stagnant: boolean;
  daysInStage: number;
}

export interface CustomerIntegrations {
  tiny: boolean;
  bling: boolean;
  wake: boolean;
}

export interface CustomerDetailPayload {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string | null;
  credits: number;
  createdAt: string | null;
  referredBy: string | null;
  referralCode: string | null;
  onboarding: {
    completed: boolean;
    completedAt: string | null;
    step1: Record<string, string> | null;
    contact: Record<string, unknown> | null;
  } | null;
  company: Record<string, unknown> | null;
  integrations: CustomerIntegrations;
  crm: CrmSummary | null;
  stagnant: boolean;
  daysInStage: number;
  productCount: number;
  whatsapp: string;
  whatsappConsent: boolean;
  whatsappConsentAt: string | null;
}

export interface TimelineEntry {
  id: string;
  kind: 'event' | 'credit';
  name: string;
  label: string;
  ts: string;
  detail: string;
  credits: number;
}

export interface AdminStats {
  total: number;
  byStage: Record<CrmStage, number>;
  byPipeline: Record<PipelineStatus, number>;
  stagnant: number;
  atRisk: number;
  notReconciled: number;
}

// Eventos que o client pode reportar pelo beacon. O servidor rejeita qualquer
// nome fora desta lista — o client não inventa evento novo.
//
// A geração de IA roda no client (Firebase AI Logic), não no servidor, então os
// eventos de geração precisam vir daqui. Isso é falsificável em tese, mas cada
// geração debita crédito de forma transacional, e o reconciliador deriva o marco
// `content_generated` de `credit_logs` — que é a fonte autoritativa. O beacon só
// acrescenta granularidade à timeline.
export const CLIENT_EVENT_NAMES = [
  'login',
  'spreadsheet_import',
  'spreadsheet_export',
  'template_downloaded',
  'seo_template_saved',
  'credit_purchase_open',
  'description_generated',
  'image_generated',
  'attributes_generated',
  'video_generated',
  'product_enriched',
  'category_hierarchy_generated',
  'product_url_import_started',
  'product_url_import_result',
  'onboarding_step_completed',
] as const;

// --- Automação de WhatsApp (spec 2, revisado no spec 3) ---

// N automações por etapa do Kanban, cada uma com seu próprio gatilho, atraso
// e template — não um motor de regras genérico com prioridade/branching entre
// elas. `id` é a chave do documento (auto-gerado); `stage` é só um campo de
// filtro, não mais a chave.
export type AutomationTrigger = 'entered' | 'stagnant';

export const TRIGGER_LABELS: Record<AutomationTrigger, string> = {
  entered: 'Ao entrar na etapa',
  stagnant: 'Ao travar na etapa',
};

export interface CrmAutomation {
  id: string;
  stage: CrmStage;
  active: boolean;
  trigger: AutomationTrigger;
  delayHours: number;
  templateName: string;
  templateLanguage: string;
  bodyParams: string[];
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface CrmMessage {
  id: string;
  // null para envios manuais e para mensagens antigas gravadas antes desta
  // mudança (id de documento era o nome da etapa, não de uma automação).
  automationId: string | null;
  stage: CrmStage | 'manual';
  trigger: AutomationTrigger | 'manual';
  templateName: string;
  to: string;
  status: 'sent' | 'failed';
  error: string | null;
  messageId: string | null;
  sentAt: string;
  manual: boolean;
  dryRun: boolean;
}

export interface WhatsAppTemplateInfo {
  name: string;
  language: string;
  status: string;
  category: string;
  bodyParamCount: number;
  bodyText: string;
}

export interface WhatsAppStatus {
  configured: boolean;
  missing: string[];
  dryRun: boolean;
  maxPerDay: number;
}

// Tokens que a automação resolve por cliente no momento do envio. Qualquer outro
// texto vai literal para o parâmetro do template.
export const TEMPLATE_TOKENS = [
  { token: '{{nome}}', description: 'Primeiro nome do cliente' },
  { token: '{{empresa}}', description: 'Nome fantasia ou razão social' },
  { token: '{{creditos}}', description: 'Saldo de créditos atual' },
  { token: '{{etapa}}', description: 'Nome da etapa atual' },
  { token: '{{dias}}', description: 'Dias parado na etapa' },
] as const;

// Valor inicial de um formulário de automação nova — ainda sem id, porque o id
// só existe depois de criada no Firestore.
export function defaultAutomation(stage: CrmStage): Omit<CrmAutomation, 'id'> {
  return {
    stage,
    active: false,
    trigger: 'stagnant',
    delayHours: 0,
    templateName: '',
    templateLanguage: 'pt_BR',
    bodyParams: [],
    updatedAt: null,
    updatedBy: null,
  };
}
