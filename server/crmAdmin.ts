// Rotas do CRM admin. TODO acesso a dados de outro usuário passa por aqui — as
// coleções do CRM são negadas ao client nas rules, então o Admin SDK é a única
// porta de entrada, e ela é auditável.

import type express from 'express';
import { adminDb, FieldValue } from './firebaseAdmin';
import { reconcileAll, reconcileUser } from './crmReconcile';
import { daysBetween, isStagnant } from './crmStage';
import { loadAutomations, runAutomations, stageFromId } from './crmAutomation';
import { resolveParams } from './crmAutomationRules';
import { isConfigured, listTemplates, sendTemplate } from './whatsappProvider';
import { isConfigured as emailIsConfigured } from './emailProvider';
import { recordEvent } from './crmEvents';
import {
  CRM_STAGES,
  PIPELINE_STATUSES,
  STAGE_LABELS,
  type AdminStats,
  type AutomationTrigger,
  type CrmAutomation,
  type CrmMessage,
  type CrmStage,
  type CrmSummary,
  type CrmTask,
  type CustomerDetailPayload,
  type CustomerListItem,
  type PipelineStatus,
  type TimelineEntry,
} from '../src/types/crm';

interface AdminDeps {
  verifyFirebaseToken: (req: express.Request) => Promise<{
    uid: string;
    email?: string;
    name?: string;
    admin?: boolean;
  }>;
}

interface AdminIdentity {
  uid: string;
  name: string;
}

const EVENT_LABELS: Record<string, string> = {
  signed_up: 'Criou a conta',
  login: 'Entrou na plataforma',
  onboarding_completed: 'Concluiu o onboarding',
  spreadsheet_import: 'Importou planilha',
  spreadsheet_export: 'Exportou planilha',
  erp_import: 'Importou produtos do ERP',
  erp_connected: 'Conectou um ERP',
  erp_push: 'Enviou produtos para o ERP',
  description_generated: 'Gerou descrição',
  image_generated: 'Gerou imagem ambientada',
  video_generated: 'Gerou vídeo',
  attributes_generated: 'Gerou atributos',
  product_enriched: 'Enriqueceu produto (GTIN/NCM)',
  category_hierarchy_generated: 'Gerou hierarquia de categorias',
  template_downloaded: 'Baixou a planilha modelo',
  seo_template_saved: 'Salvou um template de SEO',
  credit_purchase_open: 'Abriu a compra de créditos',
  credits_purchased: 'Comprou créditos',
  whatsapp_sent: 'Mensagem de WhatsApp enviada',
  email_sent: 'E-mail enviado',
};

function describeProps(props?: Record<string, unknown>): string {
  if (!props) return '';
  const parts: string[] = [];
  if (typeof props.product_count === 'number') parts.push(`${props.product_count} produtos`);
  if (typeof props.credits === 'number') parts.push(`${props.credits} créditos`);
  if (typeof props.amount === 'number') parts.push(`R$ ${props.amount.toFixed(2)}`);
  if (typeof props.sku === 'string' && props.sku) parts.push(props.sku);
  if (typeof props.provider === 'string') parts.push(props.provider);
  if (typeof props.mode === 'string') parts.push(props.mode);
  if (typeof props.source === 'string') parts.push(props.source);
  if (typeof props.template === 'string') parts.push(props.template);
  if (props.manual === true) parts.push('manual');
  if (props.dryRun === true) parts.push('simulado');
  return parts.join(' · ');
}

function sendError(res: express.Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  if (!e.status || e.status >= 500) console.error('crm admin error:', err);
  res.status(e.status ?? 500).json({ error: e.message ?? 'Erro interno' });
}

export function registerCrmAdminRoutes(app: express.Application, deps: AdminDeps): void {
  const { verifyFirebaseToken } = deps;

  // Allowlist de bootstrap. Existe para resolver o ovo-e-galinha do custom claim:
  // conceder o claim exige a API Admin de Auth, que por sua vez exige uma service
  // account — então numa máquina com ADC de usuário não haveria como abrir o CRM
  // pela primeira vez. O claim continua sendo o caminho principal e é o que
  // escala para outros admins; isto é a porta de entrada.
  //
  // O e-mail vem do ID token já verificado pelo Firebase, e o Firebase Auth
  // garante e-mail único por conta — quem apresenta o token controla a conta.
  // Ainda assim: só coloque aqui e-mails cujas contas você já criou.
  function adminEmails(): string[] {
    return (process.env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
  }

  async function requireAdmin(req: express.Request): Promise<AdminIdentity> {
    // verifyFirebaseToken só marca status 401 quando o header falta; um token
    // malformado ou expirado sobe como erro cru do Firebase, que sem este catch
    // viraria 500 e vazaria a mensagem interna. Token expirado é rotina (o
    // Firebase renova de hora em hora), então precisa ser um 401 limpo.
    let decoded: Awaited<ReturnType<typeof verifyFirebaseToken>>;
    try {
      decoded = await verifyFirebaseToken(req);
    } catch (err) {
      const status = (err as { status?: number }).status ?? 401;
      throw Object.assign(new Error('Sessão inválida ou expirada. Entre novamente.'), { status });
    }

    const email = decoded.email?.toLowerCase();
    const viaClaim = decoded.admin === true;
    const viaAllowlist = !!email && adminEmails().includes(email);

    if (!viaClaim && !viaAllowlist) {
      throw Object.assign(new Error('Acesso restrito a administradores'), { status: 403 });
    }
    return { uid: decoded.uid, name: decoded.name ?? decoded.email ?? decoded.uid };
  }

  async function auditLog(admin: AdminIdentity, uid: string, action: string, detail: string) {
    await adminDb.collection('crm_audit').add({
      uid,
      action,
      detail,
      at: new Date().toISOString(),
      by: admin.uid,
      byName: admin.name,
    });
  }

  function toListItem(
    uid: string,
    data: FirebaseFirestore.DocumentData,
    now: Date,
  ): CustomerListItem {
    const crm = (data.crm as CrmSummary | undefined) ?? null;
    return {
      uid,
      displayName: data.displayName ?? '',
      email: data.email ?? '',
      companyName: data.company?.nomeFantasia || data.company?.razaoSocial || '',
      whatsapp: data.onboarding?.contact?.whatsapp ?? '',
      credits: Number(data.credits ?? 0),
      crm,
      stagnant: crm ? isStagnant(crm, now) : false,
      daysInStage: crm ? daysBetween(crm.stageEnteredAt, now) : 0,
    };
  }

  // O client usa para decidir se libera a área do admin.
  app.get('/api/admin/me', async (req, res) => {
    try {
      const admin = await requireAdmin(req);
      res.json({ admin: true, uid: admin.uid, name: admin.name });
    } catch (err) {
      sendError(res, err);
    }
  });

  // Diagnóstico do acesso, SEM exigir ser admin — é justamente o que a tela de
  // "Acesso restrito" precisa para dizer por que o acesso foi negado. Só revela
  // se a allowlist está configurada, nunca o conteúdo dela.
  app.get('/api/admin/access-check', async (req, res) => {
    try {
      const decoded = await verifyFirebaseToken(req).catch(() => null);
      if (!decoded) return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
      res.json({
        email: decoded.email ?? null,
        viaClaim: decoded.admin === true,
        viaAllowlist: !!decoded.email && adminEmails().includes(decoded.email.toLowerCase()),
        allowlistConfigured: adminEmails().length > 0,
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  // Contagens do kanban e da fila de atenção.
  app.get('/api/admin/stats', async (req, res) => {
    try {
      await requireAdmin(req);
      const snap = await adminDb.collection('users').get();
      const now = new Date();

      const byStage = Object.fromEntries(CRM_STAGES.map((s) => [s, 0])) as Record<CrmStage, number>;
      const byPipeline = Object.fromEntries(PIPELINE_STATUSES.map((s) => [s, 0])) as Record<
        PipelineStatus,
        number
      >;
      let stagnant = 0;
      let atRisk = 0;
      let notReconciled = 0;

      for (const doc of snap.docs) {
        const crm = doc.get('crm') as CrmSummary | undefined;
        if (!crm) {
          notReconciled += 1;
          continue;
        }
        byStage[crm.stage] += 1;
        byPipeline[crm.pipelineStatus] += 1;
        if (isStagnant(crm, now)) stagnant += 1;
        if (crm.healthBand === 'risco' || crm.healthBand === 'inativo') atRisk += 1;
      }

      const stats: AdminStats = { total: snap.size, byStage, byPipeline, stagnant, atRisk, notReconciled };
      res.json(stats);
    } catch (err) {
      sendError(res, err);
    }
  });

  // Lista completa. A base é interna e pequena, então filtra e ordena em memória:
  // mais simples e evita exigir um índice composto do Firestore para cada
  // combinação de filtro.
  app.get('/api/admin/customers', async (req, res) => {
    try {
      await requireAdmin(req);
      const snap = await adminDb.collection('users').get();
      const now = new Date();
      let items = snap.docs.map((d) => toListItem(d.id, d.data(), now));

      const { stage, health, pipeline, q, stagnant } = req.query as Record<string, string | undefined>;
      if (stage) items = items.filter((i) => i.crm?.stage === stage);
      if (health) items = items.filter((i) => i.crm?.healthBand === health);
      if (pipeline) items = items.filter((i) => i.crm?.pipelineStatus === pipeline);
      if (stagnant === 'true') items = items.filter((i) => i.stagnant);
      if (q) {
        const term = q.toLowerCase();
        items = items.filter((i) =>
          [i.displayName, i.email, i.companyName].some((v) => v.toLowerCase().includes(term)),
        );
      }

      items.sort((a, b) => (b.crm?.lastSeenAt ?? '').localeCompare(a.crm?.lastSeenAt ?? ''));
      res.json({ customers: items });
    } catch (err) {
      sendError(res, err);
    }
  });

  // A ficha 360.
  app.get('/api/admin/customers/:uid', async (req, res) => {
    try {
      await requireAdmin(req);
      const uid = req.params.uid;
      const ref = adminDb.collection('users').doc(uid);
      const snap = await ref.get();
      if (!snap.exists) throw Object.assign(new Error('Cliente não encontrado'), { status: 404 });

      const data = snap.data() ?? {};
      const [tiny, bling, wake, products] = await Promise.all([
        ref.collection('settings').doc('tiny').get(),
        ref.collection('settings').doc('bling').get(),
        ref.collection('settings').doc('wake').get(),
        ref.collection('products').count().get(),
      ]);

      const crm = (data.crm as CrmSummary | undefined) ?? null;
      const now = new Date();
      const completedAt = data.onboarding?.completedAt;
      const payload: CustomerDetailPayload = {
        uid,
        displayName: data.displayName ?? '',
        email: data.email ?? '',
        photoURL: data.photoURL ?? null,
        credits: Number(data.credits ?? 0),
        createdAt: crm?.firstSeenAt ?? null,
        referredBy: data.referredBy ?? null,
        referralCode: data.referralCode ?? null,
        onboarding: data.onboarding
          ? {
              completed: data.onboarding.completed === true,
              completedAt:
                typeof completedAt === 'string'
                  ? completedAt
                  : (completedAt?.toDate?.() as Date | undefined)?.toISOString() ?? null,
              step1: data.onboarding.step1 ?? null,
              contact: data.onboarding.contact ?? null,
            }
          : null,
        company: data.company ?? null,
        integrations: {
          tiny: tiny.get('connected') === true,
          bling: bling.get('connected') === true,
          wake: wake.get('connected') === true,
        },
        crm,
        stagnant: crm ? isStagnant(crm, now) : false,
        daysInStage: crm ? daysBetween(crm.stageEnteredAt, now) : 0,
        productCount: products.data().count,
        whatsapp: String(data.onboarding?.contact?.whatsapp ?? ''),
        whatsappConsent: data.onboarding?.contact?.whatsappConsent === true,
        whatsappConsentAt: data.onboarding?.contact?.whatsappConsentAt ?? null,
      };
      res.json(payload);
    } catch (err) {
      sendError(res, err);
    }
  });

  // Eventos e credit_logs num feed só.
  app.get('/api/admin/customers/:uid/timeline', async (req, res) => {
    try {
      await requireAdmin(req);
      const ref = adminDb.collection('users').doc(req.params.uid);
      const limit = Math.min(Number(req.query.limit ?? 200), 500);

      const [eventsSnap, logsSnap] = await Promise.all([
        ref.collection('events').orderBy('ts', 'desc').limit(limit).get(),
        ref.collection('credit_logs').get(),
      ]);

      const entries: TimelineEntry[] = [];
      for (const doc of eventsSnap.docs) {
        const d = doc.data() as { name: string; ts: string; props?: Record<string, unknown> };
        entries.push({
          id: doc.id,
          kind: 'event',
          name: d.name,
          label: EVENT_LABELS[d.name] ?? d.name,
          ts: d.ts,
          detail: describeProps(d.props),
          credits: 0,
        });
      }
      for (const doc of logsSnap.docs) {
        const d = doc.data() as {
          actionType?: string;
          actionKey?: string;
          timestamp?: string;
          productName?: string;
          sku?: string;
          creditsConsumed?: number;
          creditsAdded?: number;
        };
        if (typeof d.timestamp !== 'string') continue;
        const added = Number(d.creditsAdded ?? 0);
        const used = Number(d.creditsConsumed ?? 0);
        const named = d.productName && d.productName !== 'N/A';
        entries.push({
          id: doc.id,
          kind: 'credit',
          name: d.actionKey ?? 'credit',
          label: d.actionType ?? 'Operação',
          ts: d.timestamp,
          detail: named
            ? `${d.productName}${d.sku && d.sku !== 'N/A' ? ` (${d.sku})` : ''}`
            : '',
          credits: added > 0 ? added : -used,
        });
      }

      entries.sort((a, b) => b.ts.localeCompare(a.ts));
      res.json({ entries: entries.slice(0, limit) });
    } catch (err) {
      sendError(res, err);
    }
  });

  // Move no board comercial.
  app.post('/api/admin/customers/:uid/pipeline', async (req, res) => {
    try {
      const admin = await requireAdmin(req);
      const uid = req.params.uid;
      const status = String(req.body?.status ?? '') as PipelineStatus;
      if (!(PIPELINE_STATUSES as readonly string[]).includes(status)) {
        throw Object.assign(new Error('Status comercial inválido'), { status: 422 });
      }
      const ref = adminDb.collection('users').doc(uid);
      const snap = await ref.get();
      if (!snap.exists) throw Object.assign(new Error('Cliente não encontrado'), { status: 404 });
      const crm = snap.get('crm') as CrmSummary | undefined;
      if (!crm) throw Object.assign(new Error('Cliente ainda não reconciliado'), { status: 409 });

      await ref.set(
        {
          crm: {
            ...crm,
            pipelineStatus: status,
            pipelineUpdatedAt: new Date().toISOString(),
            pipelineUpdatedBy: admin.uid,
          },
        },
        { merge: true },
      );
      await auditLog(admin, uid, 'pipeline', `${crm.pipelineStatus} → ${status}`);
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/admin/customers/:uid/tags', async (req, res) => {
    try {
      const admin = await requireAdmin(req);
      const uid = req.params.uid;
      const raw = Array.isArray(req.body?.tags) ? (req.body.tags as unknown[]) : [];
      const tags = [...new Set(raw.map((t) => String(t).trim()).filter(Boolean))].slice(0, 20);
      const ref = adminDb.collection('users').doc(uid);
      const crm = (await ref.get()).get('crm') as CrmSummary | undefined;
      if (!crm) throw Object.assign(new Error('Cliente ainda não reconciliado'), { status: 409 });
      await ref.set({ crm: { ...crm, tags } }, { merge: true });
      await auditLog(admin, uid, 'tags', tags.join(', ') || '(nenhuma)');
      res.json({ ok: true, tags });
    } catch (err) {
      sendError(res, err);
    }
  });

  // Ajuste manual de saldo. A regra creditsNotIncreased() impede o client de
  // aumentar o próprio saldo; o Admin SDK bypassa as rules, então o aumento só
  // pode acontecer aqui — e sempre com motivo e trilha de auditoria.
  app.post('/api/admin/customers/:uid/credits', async (req, res) => {
    try {
      const admin = await requireAdmin(req);
      const uid = req.params.uid;
      const delta = Number(req.body?.delta);
      const reason = String(req.body?.reason ?? '').trim();
      if (!Number.isFinite(delta) || delta === 0) {
        throw Object.assign(new Error('Informe um valor diferente de zero'), { status: 422 });
      }
      if (!reason) throw Object.assign(new Error('Informe o motivo do ajuste'), { status: 422 });

      const ref = adminDb.collection('users').doc(uid);
      const newBalance = await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw Object.assign(new Error('Cliente não encontrado'), { status: 404 });
        const current = Number(snap.get('credits') ?? 0);
        const next = current + delta;
        if (next < 0) throw Object.assign(new Error('O ajuste deixaria o saldo negativo'), { status: 422 });

        tx.update(ref, { credits: FieldValue.increment(delta) });
        tx.set(ref.collection('credit_logs').doc(), {
          type: delta > 0 ? 'bonus' : 'adjustment',
          actionType: `Ajuste do admin — ${reason}`,
          actionKey: 'admin_adjustment',
          productName: 'N/A',
          sku: 'N/A',
          userName: admin.name,
          creditsConsumed: delta < 0 ? -delta : 0,
          creditsAdded: delta > 0 ? delta : 0,
          timestamp: new Date().toISOString(),
        });
        return next;
      });

      await auditLog(admin, uid, 'credits', `${delta > 0 ? '+' : ''}${delta} — ${reason}`);
      res.json({ ok: true, credits: newBalance });
    } catch (err) {
      sendError(res, err);
    }
  });

  // --- Notas ---

  app.get('/api/admin/customers/:uid/notes', async (req, res) => {
    try {
      await requireAdmin(req);
      const snap = await adminDb
        .collection('users')
        .doc(req.params.uid)
        .collection('crm_notes')
        .orderBy('createdAt', 'desc')
        .limit(100)
        .get();
      res.json({ notes: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/admin/customers/:uid/notes', async (req, res) => {
    try {
      const admin = await requireAdmin(req);
      const body = String(req.body?.body ?? '').trim();
      if (!body) throw Object.assign(new Error('A nota não pode ficar vazia'), { status: 422 });
      const doc = await adminDb
        .collection('users')
        .doc(req.params.uid)
        .collection('crm_notes')
        .add({
          body,
          createdAt: new Date().toISOString(),
          createdBy: admin.uid,
          createdByName: admin.name,
        });
      res.json({ ok: true, id: doc.id });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.delete('/api/admin/customers/:uid/notes/:noteId', async (req, res) => {
    try {
      await requireAdmin(req);
      await adminDb
        .collection('users')
        .doc(req.params.uid)
        .collection('crm_notes')
        .doc(req.params.noteId)
        .delete();
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err);
    }
  });

  // --- Tarefas (top-level: a query dominante é "vencendo hoje", cross-cliente) ---

  app.get('/api/admin/tasks', async (req, res) => {
    try {
      await requireAdmin(req);
      // Ordena no Firestore (índice de campo único, automático) e filtra `done`
      // em memória de propósito: combinar where + orderBy exigiria um índice
      // composto, e a home inteira quebraria enquanto ele não fosse publicado.
      // O volume de tarefas de um CRM interno não justifica essa dependência.
      const snap = await adminDb.collection('crm_tasks').orderBy('dueDate', 'asc').limit(400).get();
      let tasks = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as CrmTask);
      if (req.query.open === 'true') tasks = tasks.filter((t) => !t.done);
      res.json({ tasks: tasks.slice(0, 200) });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/admin/tasks', async (req, res) => {
    try {
      const admin = await requireAdmin(req);
      const uid = String(req.body?.uid ?? '').trim();
      const title = String(req.body?.title ?? '').trim();
      const dueDate = String(req.body?.dueDate ?? '').trim();
      if (!uid || !title || !dueDate) {
        throw Object.assign(new Error('Cliente, título e prazo são obrigatórios'), { status: 422 });
      }
      const customerName = (await adminDb.collection('users').doc(uid).get()).get('displayName') ?? '';
      const doc = await adminDb.collection('crm_tasks').add({
        uid,
        customerName,
        title,
        dueDate,
        done: false,
        doneAt: null,
        createdAt: new Date().toISOString(),
        createdBy: admin.uid,
      });
      res.json({ ok: true, id: doc.id });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.patch('/api/admin/tasks/:taskId', async (req, res) => {
    try {
      await requireAdmin(req);
      const done = req.body?.done === true;
      await adminDb.collection('crm_tasks').doc(req.params.taskId).update({
        done,
        doneAt: done ? new Date().toISOString() : null,
      });
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err);
    }
  });

  // --- WhatsApp Oficial: status, templates, automações e envio ---

  app.get('/api/admin/whatsapp/status', async (req, res) => {
    try {
      await requireAdmin(req);
      res.json(isConfigured());
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/admin/email/status', async (req, res) => {
    try {
      await requireAdmin(req);
      res.json(emailIsConfigured());
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/admin/whatsapp/templates', async (req, res) => {
    try {
      await requireAdmin(req);
      res.json({ templates: await listTemplates() });
    } catch (err) {
      sendError(res, err);
    }
  });

  // Todas as automações, de todas as etapas — a UI agrupa por coluna do
  // Kanban no client.
  app.get('/api/admin/automations', async (req, res) => {
    try {
      await requireAdmin(req);
      res.json({ automations: await loadAutomations() });
    } catch (err) {
      sendError(res, err);
    }
  });

  function parseAutomationBody(body: Record<string, unknown>, stage: CrmStage) {
    const trigger: AutomationTrigger = body.trigger === 'entered' ? 'entered' : 'stagnant';
    const active = body.active === true;
    const templateName = String(body.templateName ?? '').trim();
    const emailEnabled = body.emailEnabled === true;
    const emailSubject = String(body.emailSubject ?? '').trim();
    const emailBody = String(body.emailBody ?? '');
    // As duas validações só valem quando a automação está ativa — a tela
    // salva cada campo assim que muda (um PUT por clique/tecla), então o
    // admin liga "Também enviar e-mail" antes de digitar o assunto; exigir o
    // assunto nesse momento quebraria o toggle. Só bloqueia de fato quando a
    // régua está ativa e sairia enviando algo incompleto.
    if (active) {
      const whatsappReady = !!templateName;
      const emailReady = emailEnabled && !!emailSubject;
      if (!whatsappReady && !emailReady) {
        throw Object.assign(new Error('Ative pelo menos um canal (WhatsApp ou e-mail) para ativar a automação'), { status: 422 });
      }
      if (emailEnabled && !emailSubject) {
        throw Object.assign(new Error('Escolha um assunto para ativar o e-mail'), { status: 422 });
      }
    }
    return {
      stage,
      active,
      trigger,
      delayHours: Math.max(0, Math.min(720, Number(body.delayHours ?? 0) || 0)),
      templateName,
      templateLanguage: String(body.templateLanguage ?? 'pt_BR').trim() || 'pt_BR',
      bodyParams: Array.isArray(body.bodyParams) ? body.bodyParams.map((p: unknown) => String(p)) : [],
      emailEnabled,
      emailSubject,
      emailBody,
    };
  }

  // Cria uma automação nova para a etapa informada no corpo. Não há mais
  // limite de uma por etapa — id é auto-gerado.
  app.post('/api/admin/automations', async (req, res) => {
    try {
      const admin = await requireAdmin(req);
      const body = req.body ?? {};
      const stage = stageFromId(String(body.stage ?? ''));
      if (!stage) throw Object.assign(new Error('Etapa inválida'), { status: 422 });

      const fields = parseAutomationBody(body, stage);
      const ref = adminDb.collection('crm_automations').doc();
      const automation: CrmAutomation = {
        id: ref.id,
        ...fields,
        updatedAt: new Date().toISOString(),
        updatedBy: admin.uid,
      };
      await ref.set(automation);
      await auditLog(
        admin,
        'automation',
        'automacao',
        `${STAGE_LABELS[stage]}: criada${automation.active ? ` (ativa, ${automation.templateName}, ${automation.trigger})` : ''}`,
      );
      res.json({ ok: true, automation });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.put('/api/admin/automations/:id', async (req, res) => {
    try {
      const admin = await requireAdmin(req);
      const id = req.params.id;
      const ref = adminDb.collection('crm_automations').doc(id);
      const existing = await ref.get();
      if (!existing.exists) throw Object.assign(new Error('Automação não encontrada'), { status: 404 });

      const body = req.body ?? {};
      const currentStage = (existing.data() as CrmAutomation).stage;
      const stage = stageFromId(String(body.stage ?? currentStage)) ?? currentStage;
      const fields = parseAutomationBody(body, stage);

      const automation: CrmAutomation = {
        id,
        ...fields,
        updatedAt: new Date().toISOString(),
        updatedBy: admin.uid,
      };
      await ref.set(automation);
      await auditLog(
        admin,
        'automation',
        'automacao',
        `${STAGE_LABELS[stage]}: ${automation.active ? `ativa (${automation.templateName}, ${automation.trigger})` : 'desativada'}`,
      );
      res.json({ ok: true, automation });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.delete('/api/admin/automations/:id', async (req, res) => {
    try {
      const admin = await requireAdmin(req);
      const id = req.params.id;
      const ref = adminDb.collection('crm_automations').doc(id);
      const existing = await ref.get();
      if (!existing.exists) throw Object.assign(new Error('Automação não encontrada'), { status: 404 });
      const stage = (existing.data() as CrmAutomation).stage;
      await ref.delete();
      await auditLog(admin, 'automation', 'automacao', `${STAGE_LABELS[stage]}: removida`);
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/admin/customers/:uid/messages', async (req, res) => {
    try {
      await requireAdmin(req);
      const snap = await adminDb
        .collection('users')
        .doc(req.params.uid)
        .collection('crm_messages')
        .get();
      const messages = snap.docs
        .map((d) => {
          const data = d.data();
          return {
            id: d.id,
            ...data,
            channel: data.channel ?? 'whatsapp',
            template: data.template ?? data.templateName ?? '',
          } as CrmMessage;
        })
        .sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? ''));
      res.json({ messages });
    } catch (err) {
      sendError(res, err);
    }
  });

  // Envio manual. NÃO cria doc de idempotência com id de etapa, então não
  // consome nem bloqueia a régua automática daquela etapa.
  app.post('/api/admin/customers/:uid/whatsapp', async (req, res) => {
    try {
      const admin = await requireAdmin(req);
      const uid = req.params.uid;
      const templateName = String(req.body?.templateName ?? '').trim();
      const templateLanguage = String(req.body?.templateLanguage ?? 'pt_BR').trim() || 'pt_BR';
      const rawParams = Array.isArray(req.body?.bodyParams) ? req.body.bodyParams : [];
      if (!templateName) throw Object.assign(new Error('Escolha um template'), { status: 422 });

      const ref = adminDb.collection('users').doc(uid);
      const snap = await ref.get();
      if (!snap.exists) throw Object.assign(new Error('Cliente não encontrado'), { status: 404 });
      const data = snap.data() ?? {};
      const crm = data.crm as CrmSummary | undefined;

      const whatsapp = String(data.onboarding?.contact?.whatsapp ?? '');
      if (!whatsapp.trim()) {
        throw Object.assign(new Error('Este cliente não informou WhatsApp no onboarding'), { status: 422 });
      }

      const now = new Date();
      const params = resolveParams(
        rawParams.map((p: unknown) => String(p)),
        {
          displayName: data.displayName ?? '',
          companyName: data.company?.nomeFantasia || data.company?.razaoSocial || '',
          credits: Number(data.credits ?? 0),
          stage: crm?.stage ?? 'signed_up',
          daysInStage: crm ? daysBetween(crm.stageEnteredAt, now) : 0,
        },
      );

      const messageRef = ref.collection('crm_messages').doc();
      try {
        const sent = await sendTemplate(whatsapp, templateName, templateLanguage, params);
        await messageRef.set({
          stage: 'manual', trigger: 'manual', automationId: null, channel: 'whatsapp', template: templateName, to: whatsapp,
          status: 'sent', error: null, messageId: sent.messageId,
          sentAt: now.toISOString(), manual: true, dryRun: sent.dryRun,
        });
        void recordEvent(uid, 'whatsapp_sent', { template: templateName, manual: true, dryRun: sent.dryRun });
        await auditLog(admin, uid, 'whatsapp', `envio manual: ${templateName}`);
        res.json({ ok: true, messageId: sent.messageId, dryRun: sent.dryRun });
      } catch (err) {
        await messageRef.set({
          stage: 'manual', trigger: 'manual', automationId: null, channel: 'whatsapp', template: templateName, to: whatsapp,
          status: 'failed', error: (err as Error).message.slice(0, 500), messageId: null,
          sentAt: now.toISOString(), manual: true, dryRun: false,
        });
        throw err;
      }
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/admin/customers/:uid/optout', async (req, res) => {
    try {
      const admin = await requireAdmin(req);
      const uid = req.params.uid;
      const optOut = req.body?.optOut === true;
      const ref = adminDb.collection('users').doc(uid);
      const crm = (await ref.get()).get('crm') as CrmSummary | undefined;
      if (!crm) throw Object.assign(new Error('Cliente ainda não reconciliado'), { status: 409 });
      await ref.set({ crm: { ...crm, whatsappOptOut: optOut } }, { merge: true });
      await auditLog(admin, uid, 'optout', optOut ? 'bloqueou WhatsApp' : 'liberou WhatsApp');
      res.json({ ok: true, optOut });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/admin/customers/:uid/email/optout', async (req, res) => {
    try {
      const admin = await requireAdmin(req);
      const uid = req.params.uid;
      const optOut = req.body?.optOut === true;
      const ref = adminDb.collection('users').doc(uid);
      const crm = (await ref.get()).get('crm') as CrmSummary | undefined;
      if (!crm) throw Object.assign(new Error('Cliente ainda não reconciliado'), { status: 409 });
      await ref.set({ crm: { ...crm, emailOptOut: optOut } }, { merge: true });
      await auditLog(admin, uid, 'optout', optOut ? 'bloqueou e-mail' : 'liberou e-mail');
      res.json({ ok: true, optOut });
    } catch (err) {
      sendError(res, err);
    }
  });

  // Roda a régua sob demanda, sem esperar os 30 min do scheduler.
  app.post('/api/admin/automations/run', async (req, res) => {
    try {
      await requireAdmin(req);
      res.json(await runAutomations());
    } catch (err) {
      sendError(res, err);
    }
  });

  // Backfill/recômputo. Sem uid, roda a base toda.
  app.post('/api/admin/reconcile', async (req, res) => {
    try {
      await requireAdmin(req);
      const uid = req.body?.uid ? String(req.body.uid) : null;
      if (uid) {
        const summary = await reconcileUser(uid);
        if (!summary) throw Object.assign(new Error('Cliente não encontrado'), { status: 404 });
        return res.json({ ok: true, crm: summary });
      }
      const result = await reconcileAll();
      return res.json({ ok: true, ...result });
    } catch (err) {
      return sendError(res, err);
    }
  });
}
