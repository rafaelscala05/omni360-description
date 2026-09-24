# Agente MELI — guia de configuração e operação

Implementação atual: **Fases A, B, C e E**, sempre em `audit_only`.
Não há rota de escrita em anúncios nesta fase.

## O que já está implementado

- OAuth 2.0 Authorization Code no backend, com `state` de uso único e PKCE S256.
- Tokens de vendedor cifrados com AES-256-GCM e armazenados somente no Firestore via Admin SDK.
- Rotação atômica do refresh token com lease distribuído por conexão.
- Cliente da API com timeout, retry de GET para 429/5xx, `Retry-After` e renovação em 401/403.
- Importação por status com `search_type=scan` e detalhes em lotes de até 20 por `/items/bulk`.
- Coleta de item, descrição, performance, qualidade de catálogo e schemas da categoria.
- Snapshot imutável quando o conteúdo muda, job com progresso e evento de auditoria.
- Tela “Agente MELI” com conexão, filtros, sincronização e detalhe do anúncio.
- Avisos para catálogo e User Product.
- Cache de schemas de categoria com hash e expiração de 24 horas.
- Motor determinístico de regras para obrigatoriedade, tipos, unidades, listas,
  descrição, imagens, variações, catálogo, User Products e warnings.
- Score Alfreds separado do score oficial, com cinco componentes ponderados.
- Análise textual estruturada por Gemini, validada com JSON Schema e Zod.
- Schema de serving simplificado para evitar rejeição por complexidade; o
  contrato Zod completo continua validando a resposta e há retry em JSON mode.
- Diagnóstico visual de até seis imagens por chamada, com resolução, hash
  perceptual, duplicidade e plano de melhoria.
- Sugestões candidatas de título, descrição, atributos, termos e imagens.
- Gate factual: atributos sem evidência literal são descartados e viram perguntas.
- Análises versionadas pelo `contentHash`; mudança durante a execução produz
  estado `stale`.
- Fila local com no máximo duas análises simultâneas e auditoria do resultado.
- Propostas versionadas vinculadas ao snapshot e `contentHash` da auditoria.
- Diff atual versus proposto para descrição, título, atributos, termos e plano de imagens.
- Elegibilidade compartilhada entre UI e backend: valores iguais e ações apenas
  diagnósticas não viram mudanças; limpezas seguras de HTML e título podem ser
  propostas deterministicamente mesmo quando a IA estiver indisponível.
- Matriz de risco, confirmação factual e aprovação/rejeição auditada por campo.
- Invalidação imediata de propostas quando o anúncio sincronizado muda.
- Alcance calculado para catálogo, variações, User Product e anúncios relacionados.
- Webhooks `items`, `user_products` e `user_products_families` processados com
  deduplicação, sincronização incremental e reconciliação do resultado dos jobs.
- Cache e releitura de User Products/famílias, incluindo anúncios relacionados.
- Limite adaptativo por vendedor; HTTP 429 reduz concorrência e abre cooldown.
- Leases de processamento e scheduler para retomar jobs/análises após restart.
- Métricas diárias da API e painel operacional resumido no módulo.

## Permissão do módulo

A aba **Agente MELI** e suas APIs autenticadas só ficam disponíveis quando o
documento `users/{uid}` contém:

```json
{
  "modules": {
    "meliListingOptimizer": true
  }
}
```

Sem essa permissão, a navegação não exibe a aba e os endpoints respondem `403`.

## Configuração do aplicativo no DevCenter

1. Habilitar a permissão **Leitura e escrita**. A Fase A só usa leitura, mas as fases de aplicação assistida dependerão de escrita.
2. Habilitar **PKCE** (recomendado). Se o aplicativo permanecer sem PKCE, configurar `MELI_PKCE_ENABLED=false`.
3. Cadastrar exatamente esta redirect URI de produção:

   `https://alfreds--project-95918f0d-50bb-4f66-a0d.us-east4.hosted.app/api/integrations/meli/oauth/callback`

4. Manter/cadastrar a callback de notificações:

   `https://alfreds--project-95918f0d-50bb-4f66-a0d.us-east4.hosted.app/api/mercadolivre/webhook`

5. Quando a sincronização incremental por webhook for habilitada, selecionar o tópico de itens no DevCenter.

## Secrets e variáveis

O módulo reutiliza `MERCADOLIVRE_CLIENT_ID` e `MERCADOLIVRE_CLIENT_SECRET` já existentes. Os equivalentes `MELI_CLIENT_ID` e `MELI_CLIENT_SECRET` são opcionais e têm precedência.

Obrigatórios para o fluxo de vendedor:

```text
MELI_REDIRECT_URI
MELI_PKCE_ENABLED
MELI_TOKEN_ENCRYPTION_KEY
```

`MELI_TOKEN_ENCRYPTION_KEY` deve ser um valor aleatório de 32 bytes em base64 (ou 64 caracteres hexadecimais), armazenado no Secret Manager com o nome `meli-token-encryption-key`. Nunca prefixar com `VITE_`.

Exemplo local para gerar a chave (não versionar a saída):

```bash
openssl rand -base64 32
```

## Endpoints internos

```text
POST   /api/integrations/meli/oauth/start
GET    /api/integrations/meli/oauth/callback
GET    /api/integrations/meli/connections
DELETE /api/integrations/meli/connections/primary
POST   /api/meli/sync
POST   /api/meli/listings/:itemId/sync
GET    /api/meli/listings
GET    /api/meli/listings/:itemId
POST   /api/meli/listings/:itemId/analyses
GET    /api/meli/listings/:itemId/analyses/latest
POST   /api/meli/listings/:itemId/proposals
GET    /api/meli/listings/:itemId/proposals/latest
GET    /api/meli/proposals/:proposalId
PATCH  /api/meli/proposals/:proposalId/changes/:changeId
GET    /api/meli/jobs/:jobId
GET    /api/meli/operations/metrics
POST   /api/mercadolivre/webhook
```

Todos, exceto o callback OAuth, exigem um Firebase ID token. Tokens MELI nunca aparecem nas respostas.

## Runbook curto

- **OAuth inválido:** conferir correspondência exata da redirect URI, PKCE e uso da conta administradora/principal do seller. Reconectar pelo módulo.
- **`reauthorization_required`:** o refresh token foi rejeitado definitivamente; uma nova autorização é obrigatória.
- **429:** o cliente respeita `Retry-After` e usa backoff com jitter. O job pode demorar mais, sem disparar chamadas em paralelo sem limite.
- **Job `partial`:** abrir o job para ver contadores, corrigir a causa e sincronizar novamente. Itens concluídos permanecem válidos.
- **Falha transitória na renovação:** o lease é liberado e a conexão não é revogada; repetir a operação.
- **Troca da chave de criptografia:** requer migração/reautorização planejada. Não trocar o secret diretamente enquanto houver conexões armazenadas.

## Limites atuais e próxima fase

- Fase D: escrita assistida, snapshots pré/pós-operação, verificação e rollback por nova proposta.

As filas permanecem em processo, mas os jobs são duráveis no Firestore e usam
leases: após restart, o scheduler reenfileira trabalhos sem lease válido. Uma
fila gerenciada externa poderá substituir esse adaptador sem alterar os
contratos. Imagens além da sexta recebem diagnóstico determinístico, mas não
são enviadas ao modelo visual na mesma auditoria.

O webhook responde antes do processamento pesado. A notificação só atua como
gatilho; o estado real é sempre relido pela API. Eventos duplicados são
ignorados por hash e sellers ainda não mapeados ficam em quarentena. Para
habilitar o fluxo completo no DevCenter, assinar os tópicos `items`,
`user_products` e `user_products_families`.

Como a Fase D ainda não existe, a reconciliação de User Products cobre leitura,
webhooks e sincronização de escopo. A reconciliação pós-publicação será ligada
aos mesmos mecanismos quando o executor de mudanças for implementado.

## Verificação local

```bash
npm run verify:meli
npm run verify:meli:audit
npm run verify:meli:review
npm run build
```
