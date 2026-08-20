// Stub do endpoint de notificações do Mercado Livre — a criação do app no
// DevCenter exige uma "URL de retorno de chamada de notificação" já
// funcionando (responde 2xx) antes de deixar salvar. Ainda não processamos
// nenhum tópico (orders/items/questions); só confirma o recebimento e loga
// pra referência quando formos implementar o consumo de fato.
// Docs: https://developers.mercadolivre.com.br/en_us/notifications
import express from 'express';

export function registerMercadoLivreWebhookRoutes(app: express.Express): void {
  app.post('/api/mercadolivre/webhook', (req, res) => {
    console.log('[mercadolivre-webhook] notificação recebida (ainda não processada):', JSON.stringify(req.body));
    res.status(200).end();
  });
}
