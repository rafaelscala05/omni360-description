// Ferramentas de auditoria de SEO do Agente de Conteúdo. Casca fina sobre
// server/seoAgent.ts, mesmo padrão de server/agent/tools/content.ts.

import { registerTool } from '../registry';
import { makePreview, requireStr } from '../preview';
import type { ToolCtx } from '../types';
import { CREDIT_ACTIONS } from '../../../src/credits';
import { triggerAudit, refreshAudit, cancelAudit, loadProject, debitCreditsAdmin } from '../../seoAgent';

registerTool({
  name: 'content.seo.auditoria.gerar',
  provider: 'content',
  mode: 'write',
  description: 'Dispara uma auditoria de SEO (técnica + análise de domínio) do site do projeto. Custa créditos.',
  schema: { type: 'object', properties: { projectId: { type: 'string' } }, required: ['projectId'] },
  preview: async (ctx: ToolCtx, args: Record<string, unknown>) => {
    const project = await loadProject(ctx.uid, requireStr(args, 'projectId'));
    return makePreview({
      resumo: `Rodar auditoria de SEO para "${project.config.nomeEmpresa}".`,
      alvo: project.config.nomeEmpresa,
      campos: [],
      criacao: true,
      payload: { projectId: args.projectId },
    });
  },
  execute: async (ctx: ToolCtx, _args, preview) => {
    const projectId = String((preview.payload as Record<string, unknown>).projectId);
    const project = await loadProject(ctx.uid, projectId);
    await debitCreditsAdmin(ctx.uid, CREDIT_ACTIONS.seoAudit, project.config.nomeEmpresa);
    return { audit: await triggerAudit(ctx.uid, project) };
  },
});

registerTool({
  name: 'content.seo.auditoria.atualizar',
  provider: 'content',
  mode: 'write',
  description: 'Atualiza o status de uma auditoria de SEO em andamento (poll do crawl).',
  schema: {
    type: 'object',
    properties: { projectId: { type: 'string' }, auditId: { type: 'string' } },
    required: ['projectId', 'auditId'],
  },
  preview: async (_ctx: ToolCtx, args: Record<string, unknown>) => makePreview({
    resumo: 'Atualizar status da auditoria de SEO.',
    alvo: requireStr(args, 'auditId'),
    campos: [],
    payload: args,
  }),
  execute: async (ctx: ToolCtx, _args, preview) => {
    const { projectId, auditId } = preview.payload as { projectId: string; auditId: string };
    return { audit: await refreshAudit(ctx.uid, projectId, auditId) };
  },
});

registerTool({
  name: 'content.seo.auditoria.cancelar',
  provider: 'content',
  mode: 'write',
  description: 'Cancela uma auditoria de SEO travada/lenta.',
  schema: {
    type: 'object',
    properties: { projectId: { type: 'string' }, auditId: { type: 'string' } },
    required: ['projectId', 'auditId'],
  },
  preview: async (_ctx: ToolCtx, args: Record<string, unknown>) => makePreview({
    resumo: 'Cancelar esta auditoria de SEO.',
    alvo: requireStr(args, 'auditId'),
    campos: [{ campo: 'status', antes: 'processing', depois: 'canceled', mudou: true }],
    payload: args,
  }),
  execute: async (ctx: ToolCtx, _args, preview) => {
    const { projectId, auditId } = preview.payload as { projectId: string; auditId: string };
    return { audit: await cancelAudit(ctx.uid, projectId, auditId) };
  },
});
