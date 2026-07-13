# Importação/Sincronização Tiny ERP em Background

**Data:** 2026-07-13
**Objetivo:** Mover a importação de produtos do Tiny para um job server-side que roda
em background (sobrevive a fechar a aba) e suporta sincronização recorrente de
atualizações, preservando o enriquecimento local.

## Contexto

A importação atual roda no browser (`TinyConnector.handleImport` percorre as páginas
chamando `/api/tiny/import`). Fechar a aba interrompe. Além disso é lenta (rate limit
do Tiny compartilhado por conta). Este design move o processamento para o servidor,
reaproveitando o padrão de scheduler in-process já usado pelo Alfred
(`startContentScheduler` → `setInterval(tick)` + `POST /api/content/cron/tick` com secret).

## Decisões (aprovadas)

1. **Mecanismo:** scheduler in-process (`setInterval` na instância quente do App Hosting,
   `minInstances: 1`) + `POST /api/tiny/cron/tick` gated por secret para o Cloud Scheduler.
2. **Escopo:** job sob demanda em background **+** sync recorrente automática (modo `update`).
3. **Conflito:** preservar campos enriquecidos (descrição complementar, SEO — só preenche se
   vazio); campos de origem (SKU, nome, categoria, preço, estoque, NCM, GTIN, pesos,
   dimensões, imagens) sempre atualizam.

## Estado do job (Firestore)

Coleção top-level `tiny_import_jobs/{uid}` (top-level para o worker consultar entre instâncias):
```
{
  status: 'idle' | 'queued' | 'running' | 'done' | 'error' | 'canceled',
  mode: 'full' | 'update',
  offset: number, total: number, imported: number,
  startedAt, updatedAt, finishedAt, lastSyncAt: string | null, error: string | null,
  lease: number | null,                          // epoch ms; trava anti-duplicação
  autoSync: { enabled: boolean, everyHours: number }
}
```

## Worker (`server/tinyImportWorker.ts`)

- `startTinyScheduler()` registrado no `server.ts` (ao lado de `startContentScheduler`).
  `setInterval(tick, 20s)` para progredir jobs ativos; um passo horário enfileira auto-syncs vencidos.
- `tick()`:
  1. Guard local `isTicking` (evita sobreposição na mesma instância).
  2. Query `tiny_import_jobs where status in ['queued','running']`.
  3. Para cada job, **reivindica o lease** por transação: se `lease` nulo/expirado, seta
     `lease = now + 120s` e `status = 'running'`. Só a instância que reivindicou processa
     (seguro com `maxInstances: 2`).
  4. Processa **uma página** (`limit` ~50, cursor `offset`): `GET /produtos` (modo `update`
     adiciona `dataAlteracao≥lastSyncAt`), depois `GET /produtos/{id}` por item (usa o
     `tinyFetch` existente com `PACE_MS` + backoff de 429), mapeia e faz o merge-write no
     Firestore. Atualiza `offset += itens.length`, `imported += n`, renova o lease.
  5. `offset ≥ total` (ou página vazia) → `status='done'`, `finishedAt`, `lastSyncAt=now`, `lease=null`.
  6. Erro com `status 401` (sessão Tiny) → `status='error'` com mensagem; solta o lease.
- **Auto-sync:** no passo horário, jobs `idle/done` com `autoSync.enabled` e
  `now - lastSyncAt ≥ everyHours` são reenfileirados com `mode='update', offset=0`.
- O worker precisa de um token Tiny válido por uid: usa o mesmo
  `getValidAccessToken(uid)` do `tinyAgent` (refresh automático). Exporto o necessário
  do `tinyAgent` (fetch + normalização + `getValidAccessToken`) para o worker reutilizar.

## Merge server-side

Para cada produto do Tiny (normalizado como no import atual):
- Busca existente: `users/{uid}/products where _tinyProductId == tinyId limit 1`.
- **Sempre atualiza (origem):** `Código (SKU)`, `Descrição` (nome), `Categoria`, `Preço`,
  `Preço promocional`, `GTIN/EAN`, `NCM (Classificação fiscal)`, `Peso líquido (Kg)`,
  `Peso bruto (Kg)`, `Largura embalagem`, `Altura Embalagem`, `Comprimento embalagem`,
  `URL imagem 1..N`, `_tinyProductId`.
- **Só preenche se vazio (enriquecido):** `Descrição complementar`, `Título SEO`,
  `Descrição SEO`, `Palavras chave SEO` — só grava se o campo atual estiver vazio.
- `set(..., { merge: true })` + `ownerId`, `createdAt` (preserva se existir), `updatedAt`.
- Sem existente → cria doc `tiny_${tinyId}`.
- Backup append-only em `users/{uid}/products/{docId}/tiny_versions`.

## Rotas (`registerTinyRoutes` estendido)

- `POST /api/tiny/import/start` `{ mode?: 'full'|'update' }` → cria/atualiza o job (`queued`, offset 0). 409 se já `running`.
- `GET  /api/tiny/import/status` → doc do job (status/progresso).
- `POST /api/tiny/import/cancel` → `status='canceled'`, `lease=null`.
- `POST /api/tiny/import/autosync` `{ enabled, everyHours }` → grava `autoSync`.
- `POST /api/tiny/cron/tick` → roda um `tick()`; gated por `x-tiny-cron-secret` (env `TINY_CRON_SECRET`; reusa `CONTENT_CRON_SECRET` se ausente). Nunca por token de usuário.

## UI (`TinyConnector.tsx`)

- Substitui o import síncrono por: botão **"Importar em background"** → `POST import/start`,
  depois **polling** de `GET import/status` a cada ~4s exibindo barra `imported/total` e status.
- **Pode fechar a aba**; ao reabrir, o `useEffect` consulta `status` e retoma o polling se `running`.
- Toggle **"Sincronizar automaticamente a cada [X] horas"** → `POST import/autosync`.
- Ao virar `done`, chama um callback `onImported()` que o `App.tsx` usa para **recarregar os
  produtos** do Firestore (o worker gravou lá).
- Botão **Cancelar** quando `running`.

## Limpeza

- Remove o laço `handleImport` de paginação no `TinyConnector`.
- O mapeamento Tiny→Product sai do `App.tsx` (`handleTinyImport`) e passa para o worker
  (server-side). `IntegrationsView`/`App` trocam `onTinyImport`/`getTinyPushPayload` por
  `onTinyImported` (reload) + mantêm o push.
- Sem consumo de créditos (import não é operação de IA).

## Segurança / multi-instância

- Lease em transação evita processamento duplo entre as 2 instâncias.
- `cron/tick` protegido por secret; rotas de usuário por Firebase token.
- Worker in-process depende de `minInstances ≥ 1` (ok); Cloud Scheduler chamando
  `cron/tick` é o reforço em produção.

## Validação

Sem testes automatizados → `npm run lint` limpo + boot do servidor + teste manual do fluxo
(start → status polling → fechar aba → reabrir → done → produtos no Firestore). Logs
`[tiny]` já instrumentados mostram duração/backoffs.

## Itens a confirmar na implementação

- Índice do Firestore para `collectionGroup`/query de `tiny_import_jobs` (top-level, sem índice composto necessário para `where status in [...]`).
- Filtro exato de `dataAlteracao` aceito pelo `GET /produtos` (formato de data).
