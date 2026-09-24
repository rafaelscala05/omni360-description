# Agente MELI — guia de configuração e operação

Implementação atual: **Fase A (fundação e leitura)**, sempre em `audit_only`.
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
GET    /api/meli/jobs/:jobId
```

Todos, exceto o callback OAuth, exigem um Firebase ID token. Tokens MELI nunca aparecem nas respostas.

## Runbook curto

- **OAuth inválido:** conferir correspondência exata da redirect URI, PKCE e uso da conta administradora/principal do seller. Reconectar pelo módulo.
- **`reauthorization_required`:** o refresh token foi rejeitado definitivamente; uma nova autorização é obrigatória.
- **429:** o cliente respeita `Retry-After` e usa backoff com jitter. O job pode demorar mais, sem disparar chamadas em paralelo sem limite.
- **Job `partial`:** abrir o job para ver contadores, corrigir a causa e sincronizar novamente. Itens concluídos permanecem válidos.
- **Falha transitória na renovação:** o lease é liberado e a conexão não é revogada; repetir a operação.
- **Troca da chave de criptografia:** requer migração/reautorização planejada. Não trocar o secret diretamente enquanto houver conexões armazenadas.

## Próximas fases

- Fase B: motor de regras, análise textual estruturada e diagnóstico visual.
- Fase C: propostas versionadas, diff e aprovação por campo.
- Fase D: escrita assistida, snapshots pré/pós-operação, verificação e rollback por nova proposta.
- Fase E: webhook processado, reconciliação de User Products e métricas operacionais.
