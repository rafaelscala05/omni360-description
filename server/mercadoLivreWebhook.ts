// Stub do endpoint de notificações do Mercado Livre — a criação do app no
// DevCenter exige uma "URL de retorno de chamada de notificação" já
// funcionando (responde 2xx) antes de deixar salvar. Ainda não processamos
// nenhum tópico (orders/items/questions); só confirma o recebimento e loga
// pra referência quando formos implementar o consumo de fato.
// Docs: https://developers.mercadolivre.com.br/en_us/notifications
import express from 'express';

export function registerMercadoLivreWebhookRoutes(app: express.Express): void {
  app.post('/api/mercadolivre/webhook', (req, res) => {
    // Acknowledge quickly. Never log the entire external payload: only the
    // routing fields needed to diagnose delivery. Processing will be wired to
    // the incremental sync worker in a later phase.
    console.log('[mercadolivre-webhook] notificação recebida', {
      topic: typeof req.body?.topic === 'string' ? req.body.topic : null,
      userId: req.body?.user_id != null ? String(req.body.user_id) : null,
      resource: typeof req.body?.resource === 'string' ? req.body.resource.slice(0, 160) : null,
    });
    res.status(200).end();
  });
}
