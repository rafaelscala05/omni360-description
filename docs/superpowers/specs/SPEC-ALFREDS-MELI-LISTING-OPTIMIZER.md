# Spec — Módulo de otimização de anúncios do Mercado Livre para o Alfreds

Status: Proposta para implementação
Versão: 1.0
Data: 2026-09-24
Nome sugerido do módulo: `meli-listing-optimizer`

## 1. Objetivo

Construir um novo módulo no projeto **Alfreds** capaz de:

1. conectar uma conta de vendedor do Mercado Livre;
2. importar e manter sincronizados os anúncios do vendedor;
3. analisar a qualidade comercial, técnica, textual e visual de cada anúncio;
4. gerar propostas estruturadas de melhoria;
5. permitir revisão e aprovação humana por campo;
6. publicar alterações aprovadas em descrições, atributos, termos de venda e imagens;
7. validar o resultado após a publicação e manter um histórico auditável e reversível.

O módulo deve começar no modo **assistido**. Nenhuma mudança em um anúncio real poderá ser feita sem aprovação humana explícita. Uma automação limitada poderá ser adicionada posteriormente, mas não faz parte do MVP.

## 2. Resultado esperado

Ao final do MVP, um operador deve conseguir:

- autorizar o Alfreds a acessar sua conta do Mercado Livre;
- importar todos os anúncios ativos da conta;
- abrir um anúncio e visualizar seus dados atuais, a avaliação oficial do Mercado Livre e a avaliação do Alfreds;
- identificar campos ausentes, inválidos, inconsistentes ou melhoráveis;
- gerar uma proposta de nova descrição e de preenchimento/correção de atributos;
- comparar os valores atuais e propostos;
- aprovar ou rejeitar cada mudança individualmente;
- publicar somente as mudanças aprovadas;
- conferir se o Mercado Livre efetivamente aplicou cada mudança;
- consultar o histórico completo da operação e, quando tecnicamente permitido, restaurar valores anteriores.

## 3. Princípios obrigatórios

### 3.1 Segurança por padrão

- O modo inicial deve ser `audit_only` ou `assisted`; nunca `automatic`.
- Toda escrita deve exigir autorização `write` válida e aprovação humana registrada.
- Credenciais, `client_secret`, `access_token` e `refresh_token` nunca podem ser enviados ao modelo de IA, registrados em logs de aplicação ou devolvidos ao frontend.
- Tokens devem ser criptografados em repouso e acessíveis apenas ao backend responsável pela integração.
- O sistema deve validar que o anúncio pertence ao vendedor autenticado antes de qualquer escrita.

### 3.2 IA não é fonte de fatos

O modelo pode reorganizar, resumir, revisar e sugerir conteúdo, mas não pode inventar:

- GTIN, EAN ou UPC;
- marca, modelo ou número de peça;
- dimensões, peso, potência, voltagem ou material;
- compatibilidade;
- homologações e certificações, incluindo ANATEL;
- garantia;
- conteúdo da embalagem;
- estoque, preço ou condição do produto;
- qualquer alegação técnica ou comercial não presente em fonte confiável.

Quando um dado não estiver disponível, a saída deve usar o estado `needs_confirmation` e gerar uma pergunta objetiva ao operador.

### 3.3 Alterações mínimas e reversíveis

- Enviar apenas os campos que precisam ser alterados, sempre que a API permitir atualização parcial.
- Persistir uma captura dos valores anteriores antes de cada escrita.
- Registrar request sanitizado, response, código HTTP, warnings, operador, horário e versão da proposta.
- Nunca assumir que HTTP 200 significa que todos os campos foram aplicados; reler o recurso e comparar o estado observado com o estado desejado.

### 3.4 Respeito ao modelo do Mercado Livre

O módulo deve distinguir:

- item tradicional;
- item com variações;
- publicação de catálogo;
- User Product;
- família de User Products;
- campos controlados pelo catálogo;
- campos replicados de forma assíncrona entre itens associados ao mesmo User Product.

Antes de publicar uma mudança, a interface deve apresentar o alcance estimado, por exemplo: “esta imagem pode ser replicada em outros anúncios associados ao mesmo User Product”.

## 4. Escopo

### 4.1 Dentro do MVP

- OAuth 2.0 do Mercado Livre.
- Importação de anúncios ativos, pausados e encerrados, com filtro por status.
- Coleta do item completo, descrição, ficha técnica da categoria, avaliação de performance e qualidade de catálogo quando disponível.
- Normalização e persistência dos dados coletados.
- Avaliação determinística por regras.
- Avaliação textual por IA com saída estruturada.
- Diagnóstico básico das imagens existentes.
- Propostas de descrição e atributos.
- Plano de melhoria de imagens, sem publicação automática.
- Aprovação por campo.
- Escrita de descrição, atributos, termos de venda e conjunto/ordem de imagens.
- Verificação pós-escrita.
- Histórico de auditoria e tentativa de reversão.
- Processamento assíncrono, paginação, batching, retries e tratamento de rate limit.

### 4.2 Fora do MVP

- Alteração automática de preço ou estoque.
- Criação automática de novos anúncios.
- Encerramento ou exclusão de anúncios.
- Alteração de categoria sem um fluxo separado de alto risco.
- Resposta automática a compradores.
- Gestão de pedidos, pagamentos, envios ou reputação.
- Automação sem aprovação humana.
- Geração autônoma de fatos técnicos.
- Publicação de imagens geradas por IA sem revisão explícita.

## 5. Documentação oficial de referência

Implementar contra a documentação oficial e validar os schemas reais em testes de integração:

- Portal de APIs: <https://developers.mercadolivre.com.br/pt_br/api-docs-pt-br>
- Autenticação: <https://developers.mercadolivre.com.br/autenticacao-e-autorizacao>
- Itens e buscas: <https://developers.mercadolivre.com.br/itens-e-buscas>
- Publicação de produtos: <https://developers.mercadolivre.com.br/pt_br/publicacao-de-produtos>
- Descrição: <https://developers.mercadolivre.com.br/pt_br/descricao-de-produtos>
- Atributos: <https://developers.mercadolivre.com.br/pt_br/atributos>
- Imagens: <https://developers.mercadolivre.com.br/pt_br/trabalhar-com-imagens>
- Modificação de publicações: <https://developers.mercadolivre.com.br/pt_br/produto-sincronizacao-de-publicacoes>
- Qualidade: <https://developers.mercadolivre.com.br/pt_br/qualidade-das-publicacoes>
- User Products: <https://developers.mercadolivre.com.br/pt_br/user-products>
- Rate limit: <https://developers.mercadolivre.com.br/pt_br/usuarios-e-aplicativos/rate-limit-erro-429>

Nota temporal: em 2026-09-24, a documentação informa a migração das consultas múltiplas de `/items?ids=` para `/items/bulk?ids=`, com prazo indicado de 2026-10-25. A implementação nova deve usar `/items/bulk` e não depender do endpoint em descontinuação.

## 6. Arquitetura lógica

```text
Mercado Livre API
        │
        ▼
OAuth + MELI API Client
        │
        ▼
Importador / Sincronizador ─────► Fila de jobs
        │                              │
        ▼                              ▼
Banco normalizado              Workers com retry
        │
        ├────────► Motor de regras MELI
        │
        ├────────► Analisador textual por IA
        │
        └────────► Analisador visual
                         │
                         ▼
                   Proposta versionada
                         │
                         ▼
                Revisão e aprovação humana
                         │
                         ▼
                  Executor de mudanças
                         │
                         ▼
                Releitura e reconciliação
                         │
                         ▼
                   Log de auditoria
```

O módulo deve ser dividido em componentes com interfaces internas independentes do framework utilizado pelo Alfreds:

1. `MeliOAuthService`
2. `MeliApiClient`
3. `ListingSyncService`
4. `CategorySchemaService`
5. `ListingRuleEngine`
6. `ListingAIAnalyzer`
7. `ListingImageAnalyzer`
8. `ProposalService`
9. `ApprovalService`
10. `ListingMutationService`
11. `ListingVerificationService`
12. `ListingAuditService`

## 7. Integração com a API do Mercado Livre

### 7.1 OAuth

Implementar Authorization Code Flow no backend.

Requisitos:

- gerar e validar `state` criptograficamente seguro;
- usar exatamente a mesma `redirect_uri` registrada na aplicação;
- trocar o código por token via `POST /oauth/token` com parâmetros no body;
- armazenar `access_token`, `refresh_token`, expiração, escopos e `user_id`;
- renovar somente quando necessário;
- substituir atomicamente o refresh token antigo pelo novo;
- impedir renovações concorrentes para a mesma conexão;
- marcar a conexão como `reauthorization_required` quando a renovação falhar definitivamente;
- nunca expor tokens ao navegador.

Variáveis de configuração sugeridas:

```text
MELI_CLIENT_ID
MELI_CLIENT_SECRET
MELI_REDIRECT_URI
MELI_API_BASE_URL=https://api.mercadolibre.com
MELI_AUTH_BASE_URL=https://auth.mercadolivre.com.br
MELI_TOKEN_ENCRYPTION_KEY
```

### 7.2 Endpoints de leitura

| Finalidade | Método e recurso |
|---|---|
| Usuário autenticado | `GET /users/me` |
| Listar IDs dos anúncios | `GET /users/{seller_id}/items/search` |
| Filtrar por status | `GET /users/{seller_id}/items/search?status={status}` |
| Buscar detalhes em lote | `GET /items/bulk?ids={comma_separated_ids}` |
| Detalhe completo | `GET /items/{item_id}?include_attributes=all` |
| Descrição | `GET /items/{item_id}/description` |
| Performance oficial | `GET /item/{item_id}/performance` |
| Qualidade de catálogo | `GET /catalog_quality/status?item_id={item_id}&v=3` |
| Atributos da categoria | `GET /categories/{category_id}/attributes` |
| Ficha técnica de entrada | `GET /categories/{category_id}/technical_specs/input` |
| Ficha técnica de saída | `GET /categories/{category_id}/technical_specs/output` |
| User Product | `GET /user-products/{user_product_id}` |
| Família de User Products | `GET /sites/{site_id}/user-products-families/{family_id}` |
| Itens do User Product | `GET /users/{seller_id}/items/search?user_product_id={user_product_id}` |

O cliente deve aceitar respostas `200` e, quando documentado, `206`. Em respostas parciais, registrar os campos indicados pelo header `X-Content-Missing` e prosseguir somente se os dados ausentes não forem necessários à operação corrente.

### 7.3 Endpoints de escrita

| Finalidade | Método e recurso |
|---|---|
| Criar descrição inexistente | `POST /items/{item_id}/description` |
| Substituir descrição existente | `PUT /items/{item_id}/description?api_version=2` |
| Alterar atributos, termos ou imagens | `PUT /items/{item_id}` |
| Adicionar imagem previamente carregada | `POST /items/{item_id}/pictures` quando aplicável |

Descrição deve ser enviada em `plain_text`. O módulo não deve produzir HTML para esse campo.

### 7.4 Rate limit e resiliência

- Centralizar chamadas no `MeliApiClient`.
- Implementar timeout, cancelamento e retry apenas para operações idempotentes ou protegidas por chave interna de idempotência.
- Para HTTP 429 e erros transitórios, usar backoff exponencial com jitter.
- Respeitar `Retry-After` quando presente.
- Limitar concorrência por vendedor e por aplicação.
- Processar lotes pequenos e configuráveis.
- Não executar retry cego em `POST` ou `PUT` cujo resultado seja desconhecido; primeiro reler o recurso.
- Guardar métricas de latência, volume, códigos HTTP, retries e 429.

## 8. Modelo de dados mínimo

Adaptar nomes e tipos às convenções do Alfreds, preservando os conceitos abaixo.

### `meli_connections`

```text
id
tenant_id
seller_id
site_id
access_token_encrypted
refresh_token_encrypted
token_expires_at
scopes
status: active | reauthorization_required | revoked
created_at
updated_at
```

### `meli_listings`

```text
id
tenant_id
connection_id
item_id (unique por conexão)
seller_id
site_id
user_product_id nullable
family_id nullable
catalog_product_id nullable
category_id
domain_id nullable
status
title
condition
sold_quantity
available_quantity
permalink
raw_item_json
source_last_updated_at
last_synced_at
created_at
updated_at
```

### `meli_listing_content`

```text
listing_id
description_plain_text
attributes_json
sale_terms_json
variations_json
pictures_json
shipping_json
performance_json nullable
catalog_quality_json nullable
category_schema_version/hash
content_hash
updated_at
```

### `meli_listing_snapshots`

Captura imutável usada para comparação e reversão.

```text
id
listing_id
reason: sync | before_mutation | after_mutation | rollback
item_json
description_json
captured_at
```

### `meli_listing_analyses`

```text
id
listing_id
snapshot_id
ruleset_version
model_provider nullable
model_name nullable
prompt_version nullable
official_score nullable
alfreds_score
risk_level: low | medium | high | blocked
findings_json
questions_json
status: queued | running | completed | failed | stale
created_at
completed_at nullable
```

### `meli_listing_proposals`

```text
id
listing_id
analysis_id
base_snapshot_id
version
status: draft | awaiting_review | partially_approved | approved | rejected | applying | applied | partially_applied | failed | stale
summary
impact_scope_json
created_by_type: user | ai | rule
created_at
updated_at
```

### `meli_listing_changes`

Uma linha por campo lógico alterável.

```text
id
proposal_id
field_path
change_type: add | replace | remove | reorder
old_value_json
new_value_json
reason
evidence_json
confidence
risk_level
requires_confirmation
approval_status: pending | approved | rejected
approved_by nullable
approved_at nullable
```

### `meli_mutation_runs`

```text
id
proposal_id
idempotency_key
status: queued | running | verifying | succeeded | partial | failed | rolled_back
sanitized_request_json
response_status nullable
sanitized_response_json nullable
warnings_json nullable
started_at
completed_at nullable
```

### `meli_audit_events`

```text
id
tenant_id
actor_type
actor_id nullable
action
resource_type
resource_id
metadata_json
created_at
```

## 9. Fluxo de sincronização

### 9.1 Sincronização inicial

1. Validar conexão e obter `/users/me`.
2. Persistir `seller_id` e `site_id`.
3. Paginar `/users/{seller_id}/items/search` por status solicitado.
4. Dividir IDs em lotes compatíveis com `/items/bulk`.
5. Buscar detalhes completos quando o retorno bulk não contiver todos os campos necessários.
6. Buscar descrição de cada item.
7. Armazenar schemas de categoria em cache por `category_id`.
8. Buscar `/performance` e `catalog_quality/status` quando aplicáveis.
9. Detectar `user_product_id`, catálogo e variações.
10. Normalizar dados e criar snapshot `sync`.
11. Enfileirar análise somente se o `content_hash` tiver mudado ou se não houver análise válida.

### 9.2 Sincronização incremental

Suportar inicialmente:

- sincronização manual de um anúncio;
- sincronização manual de toda a conta;
- job periódico configurável;
- reconsulta obrigatória antes de aplicar uma proposta.

Se o Alfreds já possuir infraestrutura de webhooks/notificações, integrar os eventos de itens como otimização posterior. Não bloquear o MVP por isso.

## 10. Motor de análise

### 10.1 Ordem da análise

1. Validar integridade dos dados importados.
2. Executar regras determinísticas.
3. Construir um pacote de contexto sem credenciais nem dados pessoais desnecessários.
4. Executar análise textual por IA com schema de saída estrito.
5. Executar análise visual das imagens.
6. Consolidar achados, eliminando duplicatas.
7. Calcular nota e risco.
8. Gerar perguntas para dados factuais ausentes.
9. Gerar proposta somente para campos tecnicamente alteráveis.

### 10.2 Regras determinísticas mínimas

O motor deve detectar:

- atributo com tag `required` ausente;
- atributo recomendado em `technical_specs/input` ausente;
- tipo, unidade, comprimento ou valor incompatível com o schema da categoria;
- `GTIN`, `BRAND`, `MODEL` e outros atributos de alta relevância ausentes, quando aplicáveis;
- divergência literal evidente entre título, atributos e descrição;
- descrição vazia, excessivamente curta ou com conteúdo inválido;
- tentativa de uso de HTML na descrição;
- título possivelmente não editável por haver vendas;
- ausência de imagens ou quantidade superior ao limite da categoria;
- imagem referenciada por variação que seria removida;
- anúncio associado a catálogo ou User Product;
- mudança que pode se propagar para mais de um item;
- publicação com warning ou restrição retornada pela API;
- análise ou proposta desatualizada em relação ao último snapshot.

### 10.3 Pontuação interna

Usar uma nota de 0 a 100 separada da nota oficial do Mercado Livre. Não apresentar a nota interna como se fosse oficial.

Pesos iniciais, configuráveis:

```text
completude técnica: 35
consistência factual: 20
qualidade do título: 15
qualidade da descrição: 15
qualidade/cobertura das imagens: 15
```

Bloqueadores factuais devem limitar a nota e impedir publicação, independentemente da média.

### 10.4 Contrato de saída da IA

A resposta deve ser validada contra JSON Schema. Exemplo conceitual:

```json
{
  "summary": "string",
  "score_components": {
    "title": 0,
    "description": 0,
    "technical_completeness": 0,
    "consistency": 0,
    "images": 0
  },
  "findings": [
    {
      "code": "DESCRIPTION_MISSING_KEY_DETAIL",
      "field_path": "description.plain_text",
      "severity": "medium",
      "message": "string",
      "evidence": ["string"],
      "source": "listing|category_schema|meli_performance|image|operator",
      "confidence": 0.0,
      "requires_confirmation": false
    }
  ],
  "questions": [
    {
      "field_path": "attributes.GTIN",
      "question": "Qual é o código GTIN/EAN impresso na embalagem?",
      "reason": "O dado não consta nas fontes disponíveis."
    }
  ],
  "suggestions": {
    "title": null,
    "description_plain_text": "string|null",
    "attributes": [],
    "sale_terms": [],
    "picture_plan": []
  }
}
```

Qualquer atributo sugerido deve conter evidência explícita. Sem evidência, ele deve aparecer apenas em `questions`, não em `suggestions.attributes`.

## 11. Regras editoriais

### 11.1 Título

- Preferir a estrutura produto + marca + modelo + especificação relevante.
- Evitar promoções, frete, parcelamento, condição do produto e pontuação ornamental.
- Não inserir palavras-chave desconectadas do produto.
- Respeitar o limite real informado pela API/categoria.
- Bloquear sugestão de escrita quando o título não for editável.
- Em User Products, detectar se o título é derivado/gerenciado e apresentar apenas recomendação, se a API não admitir edição direta segura.

### 11.2 Descrição

- Produzir somente texto simples.
- Priorizar informações úteis que não estejam claramente cobertas pela ficha técnica.
- Usar parágrafos e quebras de linha; não usar HTML.
- Não inserir contatos, URLs, promessas ou alegações sem evidência.
- Evitar repetição artificial de palavras-chave.
- Estrutura sugerida, quando aplicável:
  1. resumo do produto;
  2. benefícios verificáveis;
  3. usos e compatibilidades confirmadas;
  4. conteúdo da embalagem confirmado;
  5. garantia confirmada;
  6. observações relevantes.

### 11.3 Atributos e termos de venda

- Consultar o schema vigente da categoria antes de propor ou publicar.
- Preferir `value_id` oficial quando houver correspondência segura.
- Respeitar `value_type`, `allowed_units`, `value_max_length` e tags.
- Não remover atributo obrigatório.
- Não converter ausência de informação em valor `N/A` sem justificativa e suporte do schema.
- Tratar garantia e outros termos em `sale_terms` quando esse for o local definido pela API.

## 12. Imagens

### 12.1 Análise do conjunto atual

Para cada imagem, armazenar ID, URL, ordem, dimensões quando disponíveis, vínculo com variações e hash perceptual quando tecnicamente possível.

O diagnóstico deve avaliar:

- resolução e proporção;
- nitidez e iluminação;
- fundo e legibilidade do produto;
- presença de marca d'água, bordas, contato ou texto promocional;
- duplicidade ou imagens quase idênticas;
- coerência entre imagem, título, cor e variação;
- qualidade da imagem principal;
- cobertura de ângulos, detalhes, escala, acessórios e embalagem.

### 12.2 Plano de melhoria

A saída deve separar:

- `keep`: manter;
- `reorder`: reordenar;
- `remove`: remover após aprovação;
- `replace`: substituir;
- `create`: produzir nova fotografia ou peça visual;
- `needs_review`: possível incompatibilidade factual.

No MVP, geração ou edição de imagem deve produzir um ativo candidato, nunca substituir a imagem do anúncio diretamente.

### 12.3 Publicação

- Antes do `PUT`, reler item e variações.
- Preservar todas as imagens existentes que não tenham remoção aprovada.
- Montar o array `pictures` completo na ordem desejada.
- Validar limites `max_pictures_per_item` e `max_pictures_per_item_var`.
- Preservar vínculos de `picture_ids` das variações.
- Usar uma nova URL/source ao substituir conteúdo para evitar cache.
- Exigir aprovação específica para mudança da primeira imagem.
- Verificar o conjunto final após o `PUT`.

## 13. Propostas e aprovação

### 13.1 Criação

Toda proposta deve apontar para um `base_snapshot_id`. Se o anúncio mudar depois desse snapshot, a proposta se torna `stale` e não pode ser aplicada sem reanálise ou reconciliação.

### 13.2 Interface mínima

A tela de revisão deve mostrar:

- identificação do anúncio e link público;
- score oficial e score Alfreds claramente separados;
- problemas agrupados por gravidade;
- valor atual e valor proposto por campo;
- justificativa e evidência;
- confiança;
- alcance da mudança;
- aviso para catálogo, variações e User Products;
- botões aprovar/rejeitar por mudança;
- aprovação em lote apenas para mudanças de baixo risco;
- botão final “Aplicar alterações aprovadas”.

### 13.3 Matriz de risco inicial

| Mudança | Risco padrão | Regra |
|---|---:|---|
| Correção ortográfica na descrição | Baixo | Pode ser aprovada em lote |
| Reestruturação da descrição | Médio | Revisão individual |
| Inclusão de atributo com evidência | Médio | Revisão individual |
| GTIN, compatibilidade, certificação ou garantia | Alto | Confirmação factual explícita |
| Alteração de título | Alto | Validar vendas e editabilidade |
| Reordenação de imagens | Médio | Aprovação individual |
| Troca da imagem principal | Alto | Aprovação explícita |
| Remoção de imagem | Alto | Confirmar vínculos com variações |
| Alteração de categoria | Bloqueado no MVP | Fluxo futuro separado |
| Preço ou estoque | Bloqueado no MVP | Fora de escopo |

## 14. Execução das mudanças

### 14.1 Pré-condições

Antes de qualquer escrita:

1. verificar conexão ativa e escopo `write`;
2. reler o anúncio e a descrição;
3. confirmar propriedade pelo `seller_id`;
4. comparar o conteúdo atual com o `base_snapshot`;
5. invalidar ou reconciliar proposta divergente;
6. consultar novamente schema de categoria quando o cache estiver vencido;
7. identificar catálogo, variações e User Product;
8. calcular e exibir o alcance;
9. criar snapshot `before_mutation`;
10. garantir que há aprovações válidas para todas as mudanças enviadas.

### 14.2 Agrupamento

Separar operações por recurso:

- descrição: `POST` ou `PUT /description`;
- item: atributos, `sale_terms` e imagens por `PUT /items/{item_id}`;
- não enviar preço, estoque ou outros campos fora do escopo por acidente.

Mudanças independentes devem produzir resultados independentes. Uma falha na descrição não deve ocultar o sucesso dos atributos, e vice-versa.

### 14.3 Verificação

Após cada operação:

1. aguardar somente o necessário para consistência eventual;
2. reler o recurso;
3. normalizar os valores;
4. comparar desejado versus observado;
5. registrar `succeeded`, `partial` ou `failed`;
6. capturar warnings e diferenças;
7. criar snapshot `after_mutation`;
8. atualizar a proposta para `applied` somente quando todas as mudanças aprovadas forem confirmadas.

Para alterações replicadas de modo assíncrono em User Products, permitir estado `verifying` e executar reconciliação posterior.

### 14.4 Reversão

- Reversão nunca deve ser apresentada como garantida.
- Gerar uma nova proposta a partir do snapshot anterior.
- Revalidar regras atuais, editabilidade e schema da categoria.
- Exigir nova aprovação humana.
- Não usar comandos destrutivos nem restaurar cegamente um JSON completo antigo.

## 15. User Products, catálogo e variações

### 15.1 User Products

Se `user_product_id` existir:

- buscar os detalhes do User Product;
- determinar `family_id` quando disponível;
- buscar itens relacionados;
- classificar campos como compartilhados ou específicos de condição de venda;
- apresentar IDs dos anúncios potencialmente impactados;
- não presumir que uma mudança afetará somente o item solicitado;
- verificar replicação assíncrona após a escrita.

### 15.2 Catálogo

Se `catalog_product_id` ou flags equivalentes indicarem catálogo:

- identificar campos controlados pelo catálogo;
- não enviar mudanças não permitidas;
- transformar sugestões bloqueadas em recomendação informativa;
- registrar motivo técnico do bloqueio.

### 15.3 Variações

- Preservar IDs e atributos de combinação.
- Não remover atributos usados para diferenciar variações.
- Validar imagens associadas a cada variação.
- Impedir que duas variações fiquem semanticamente idênticas após a mudança.
- Tratar limites de imagens por variação.

## 16. API interna sugerida para o Alfreds

Adaptar ao padrão existente do projeto.

```text
POST   /integrations/meli/oauth/start
GET    /integrations/meli/oauth/callback
GET    /integrations/meli/connections
DELETE /integrations/meli/connections/{connectionId}

POST   /meli/sync
POST   /meli/listings/{itemId}/sync
GET    /meli/listings
GET    /meli/listings/{itemId}

POST   /meli/listings/{itemId}/analyses
GET    /meli/listings/{itemId}/analyses/latest

POST   /meli/listings/{itemId}/proposals
GET    /meli/proposals/{proposalId}
PATCH  /meli/proposals/{proposalId}/changes/{changeId}
POST   /meli/proposals/{proposalId}/apply
POST   /meli/proposals/{proposalId}/rollback-proposal

GET    /meli/jobs/{jobId}
GET    /meli/audit-events
```

Respostas de comandos assíncronos devem retornar `202 Accepted` com `job_id`.

## 17. Estados dos jobs

```text
queued
running
retry_scheduled
waiting_for_consistency
succeeded
partial
failed
cancelled
```

Todo job deve ter progresso, última etapa concluída, erro sanitizado e correlação com conexão, anúncio, análise ou proposta.

## 18. Observabilidade e auditoria

### Métricas mínimas

- anúncios sincronizados por status;
- duração de sincronização;
- chamadas por endpoint e status HTTP;
- taxa de 429 e retries;
- análises concluídas/falhas;
- propostas criadas, aprovadas e aplicadas;
- mudanças confirmadas, parciais e rejeitadas pela API;
- tempo entre aplicação e confirmação;
- divergências de User Products.

### Logs

- Usar correlation ID.
- Não registrar tokens, secrets ou payloads integrais com dados desnecessários.
- Sanitizar headers `Authorization`.
- Registrar IDs técnicos suficientes para suporte.

### Auditoria

Toda ação humana ou automática relevante deve gerar evento imutável, incluindo aprovação, rejeição, aplicação, falha, reautorização e criação de proposta de rollback.

## 19. Testes obrigatórios

### 19.1 Unidade

- renovação e rotação de refresh token;
- paginação e batching;
- normalização de item e descrição;
- validação de atributos por tipo/unidade/lista;
- regras editoriais determinísticas;
- cálculo de risco e score;
- invalidação de proposta stale;
- construção de payload parcial;
- preservação e reordenação de imagens;
- sanitização de logs;
- backoff e classificação de erros.

### 19.2 Contrato

- Fixtures realistas e anonimizadas de `/items`, `/description`, `/performance`, categorias e User Products.
- Validar tolerância a novos campos e campos opcionais.
- Validar HTTP 206, 400, 401, 403, 404, 409, 429 e 5xx.

### 19.3 Integração

Usar usuário de teste do Mercado Livre quando disponível:

- OAuth completo;
- importar anúncio;
- criar descrição inexistente;
- substituir descrição;
- adicionar atributo permitido;
- rejeitar atributo inválido;
- reordenar imagens preservando as existentes;
- reler e confirmar mudanças;
- simular proposta stale;
- simular refresh token concorrente;
- simular 429 e consistência eventual.

### 19.4 End-to-end

1. conectar conta;
2. sincronizar anúncio;
3. gerar análise;
4. criar proposta;
5. aprovar descrição e rejeitar um atributo;
6. aplicar somente a descrição;
7. confirmar estado final;
8. visualizar trilha de auditoria.

## 20. Critérios de aceite do MVP

- [ ] Um vendedor conecta a conta sem expor tokens ao frontend.
- [ ] O sistema lista e importa anúncios com paginação e batching.
- [ ] Cada anúncio apresenta item, descrição, atributos, imagens, variações e qualidade oficial quando disponível.
- [ ] A análise distingue fatos, inferências e dados que exigem confirmação.
- [ ] Nenhum atributo factual sem evidência é proposto para publicação.
- [ ] O sistema gera descrição em texto simples e valida o payload.
- [ ] O operador aprova ou rejeita cada mudança.
- [ ] Propostas baseadas em snapshots antigos são bloqueadas como `stale`.
- [ ] Somente mudanças aprovadas entram no payload.
- [ ] O sistema cria snapshot anterior e posterior à alteração.
- [ ] O resultado é reconsultado e comparado com o desejado.
- [ ] Catálogo, variações e User Products recebem tratamento e avisos próprios.
- [ ] Mudança de imagem principal exige aprovação explícita.
- [ ] Preço, estoque, categoria e encerramento não podem ser modificados pelo MVP.
- [ ] 401/429/5xx e falhas parciais têm tratamento observável.
- [ ] Logs não contêm tokens ou secrets.
- [ ] Testes unitários, de contrato e o cenário E2E principal passam no CI.

## 21. Plano de implementação

### Fase A — Fundação e leitura

- Mapear arquitetura, autenticação, banco, jobs e UI existentes no Alfreds.
- Implementar migrations e entidades.
- Implementar OAuth e armazenamento seguro de tokens.
- Implementar `MeliApiClient`.
- Implementar sincronização e visualização somente leitura.
- Adicionar fixtures e testes de contrato.

Entrega: conta conectada e anúncios navegáveis no Alfreds, sem escrita.

### Fase B — Auditoria

- Implementar cache de schemas de categoria.
- Implementar regras determinísticas.
- Integrar `/performance` e qualidade de catálogo.
- Implementar análise textual estruturada por IA.
- Implementar diagnóstico visual.
- Exibir scores, achados e perguntas.

Entrega: auditoria completa, ainda sem escrita.

### Fase C — Propostas e revisão

- Criar propostas versionadas.
- Criar diff por campo.
- Implementar matriz de risco.
- Implementar aprovações e invalidação por snapshot.
- Apresentar alcance de User Products, catálogo e variações.

Entrega: revisão humana completa, ainda sem escrita.

### Fase D — Escrita controlada

- Implementar descrição.
- Implementar atributos e `sale_terms`.
- Implementar imagens com preservação de variações.
- Implementar snapshots, verificação e auditoria.
- Implementar proposta de rollback.

Entrega: aplicação assistida e verificável.

### Fase E — Robustez

- Rate limiting adaptativo.
- Reconciliação assíncrona de User Products.
- Notificações/webhooks, se compatíveis com a infraestrutura.
- Dashboards operacionais.
- Testes de carga e falha.

## 22. Instruções para o agente implementador

1. Leia integralmente este spec antes de editar código.
2. Inspecione o repositório Alfreds e procure `AGENTS.md` e instruções locais.
3. Identifique stack, padrões de módulo, autenticação, multi-tenancy, banco, filas, frontend, testes e observabilidade já existentes.
4. Produza um plano curto mapeando este spec para arquivos e componentes reais do repositório.
5. Não introduza um segundo framework, ORM, sistema de filas ou biblioteca de UI se o projeto já possuir equivalentes.
6. Faça a implementação em fases pequenas e testáveis, começando por leitura e modo `audit_only`.
7. Use adaptadores para isolar a API do Mercado Livre e o provedor de IA.
8. Não implemente escrita antes de snapshots, aprovação, auditoria e validação de propriedade estarem funcionando.
9. Confirme na documentação oficial qualquer endpoint ou payload cuja resposta real divirja deste spec.
10. Preserve compatibilidade futura: parsear apenas campos necessários, tolerar campos adicionais e tratar opcionais como opcionais.
11. Não registrar nem enviar credenciais a modelos.
12. Ao concluir cada fase, execute testes e documente decisões, limitações e pendências.

## 23. Questões a resolver durante o encaixe no Alfreds

Estas decisões dependem do repositório e não devem ser inventadas antes da inspeção:

- qual entidade representa `tenant`, organização ou usuário;
- qual serviço de secrets/criptografia já é utilizado;
- qual fila e scheduler estão disponíveis;
- qual provedor de IA e mecanismo de structured output o projeto usa;
- onde ativos candidatos de imagem devem ser armazenados;
- política de retenção de snapshots e imagens;
- papéis autorizados a conectar contas, aprovar e publicar;
- frequência padrão da sincronização incremental;
- limites internos de concorrência e tamanho de lote;
- estratégia de feature flags e rollout.

Se alguma dessas respostas exigir mudança arquitetural relevante, o agente deve registrar a decisão e solicitar aprovação antes de ampliar o escopo.

## 24. Definição de pronto

O módulo só será considerado pronto quando:

1. todos os critérios de aceite estiverem satisfeitos;
2. o caminho principal estiver coberto por teste E2E;
3. tokens e dados sensíveis tiverem revisão de segurança;
4. uma alteração real em ambiente de teste tiver sido aplicada e verificada;
5. catálogo, variações e User Products tiverem casos de teste ou limitações explicitamente documentadas;
6. houver runbook para falhas de OAuth, 429, alteração parcial e inconsistência pós-escrita;
7. o modo de produção continuar assistido e exigir aprovação humana.
