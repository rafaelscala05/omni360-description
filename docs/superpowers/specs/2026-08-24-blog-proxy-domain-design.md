# Blog: domínio via proxy de caminho (`/blog`)

## Contexto e motivação

O módulo Blog já suporta domínio customizado por CNAME (`server/cloudflareSaas.ts`,
`method` implícito de hoje): o cliente aponta um CNAME do domínio (ou subdomínio)
inteiro para `CLOUDFLARE_SAAS_CNAME_TARGET`, a Cloudflare emite o certificado e
encaminha via `workers/blog-proxy/worker.js` pro App Hosting, carregando o
domínio original em `X-Forwarded-Host` autenticado por `BLOG_PROXY_SECRET`.

A maioria dos próximos clientes não quer entregar o domínio inteiro pro Alfred —
querem manter o site atual (em geral cPanel) e só apontar o caminho `/blog` pra
cá. Esse caso já tem serving parcialmente pronto em `blogPublic.ts` (reconhece o
prefixo `/blog`), mas o registro/autenticação do domínio não existe pra esse
cenário: `blogAdmin.ts` sempre chama a Custom Hostname API da Cloudflare, que só
faz sentido quando o hostname inteiro é delegado à zona do Alfred.

Um teste direto contra o App Hosting confirmou que o edge rejeita qualquer
`Host` não registrado com 404, antes do Express ver a requisição — então
qualquer encaminhador externo (nosso Worker, uma Worker Route na zona do
próprio cliente, ou um API Gateway de terceiro) precisa bater com
`Host: alfreds.com.br` e carregar o domínio real por outro canal.

Decisão: em vez de reusar `BLOG_PROXY_SECRET` (um segredo global, pensado para
um único ator confiável) para encaminhadores operados por terceiros, cada
domínio ganha seu próprio token. Vazamento de um token expõe só aquele domínio;
o global continua servindo exclusivamente o fluxo CNAME existente.

## Modelo de dados

`BlogDomainDoc` (`src/modules/content/blog/types.ts`) ganha:

```ts
interface BlogDomainDoc {
  uid: string;
  projectId: string;
  verified: boolean;
  createdAt: string;
  method: 'cname' | 'proxy';       // novo, default 'cname' pros docs existentes
  cloudflareHostnameId?: string;   // já existe — só usado quando method === 'cname'
  proxyToken?: string;             // novo — só usado quando method === 'proxy'
}
```

Sem migração de dados: nenhum domínio em produção usa o método novo ainda: os
docs existentes (se houver) seguem tratados como `method: 'cname'` quando o
campo não existir (default na leitura, não precisa de backfill).

## Registro (`server/blogAdmin.ts`)

`POST /api/blog/projects/:projectId/domains` passa a aceitar
`{ domain, method }`.

- `method: 'cname'` — comportamento idêntico ao de hoje (Custom Hostname API).
- `method: 'proxy'` — não chama a Cloudflare. Gera `proxyToken` com
  `crypto.randomBytes(24).toString('base64url')`, grava o doc com
  `verified: false`, devolve `{ domain, method: 'proxy', proxyToken }`. Mesmo
  `ref.create()` atômico já usado hoje pra evitar corrida entre contas
  disputando o mesmo domínio.

`GET /api/blog/projects/:projectId/domains/:domain` (endpoint novo, não existe
hoje — a UI só recebe o token na resposta do POST) devolve o doc atual
(`method`, `verified`, `proxyToken` quando `proxy`) pra reexibir o token se o
usuário sair da tela e voltar.

`POST /.../domains/:domain/verify` se ramifica por `method`:
- `cname`: inalterado (consulta `getCustomHostname`).
- `proxy`: faz `fetch(`https://${domain}/blog/`)` com timeout curto (5s) e
  confere o header de resposta `X-Alfred-Blog: proxy-ok` (ver seção seguinte).
  Presente → `verified: true`. Ausente, erro de rede ou timeout → `verified:
  false` com `detail` explicando o problema mais provável (DNS não aponta pro
  gateway, gateway não configurado, token errado).

`POST /.../domains/:domain/rotate-token` (endpoint novo) — regenera
`proxyToken` pra um domínio `proxy` já registrado, sem precisar apagar e
recriar. Zera `verified` (o cliente precisa reconfigurar o gateway com o novo
token e verificar de novo).

`DELETE /.../domains/:domain` — pra `method: 'proxy'`, só apaga o doc (sem
chamada à Cloudflare).

## Autenticação e resolução em tempo de request (`server/blogPublic.ts`)

Hoje o middleware de domínio customizado começa assim:

```ts
app.use(async (req, res, next) => {
  if (req.method !== 'GET') return next();
  const host = resolvedHost(req);
  if (!host || platformHosts.has(host)) return next();
  ...
```

Todo tráfego `proxy` chega com `Host: alfreds.com.br` — que está em
`platformHosts` — então cairia nesse atalho e nunca seria resolvido. A checagem
de token precisa vir antes:

```ts
app.use(async (req, res, next) => {
  if (req.method !== 'GET') return next();

  const token = req.headers['x-blog-domain-token'] as string | undefined;
  if (token) {
    const resolved = await loadTenantByProxyToken(token); // cache com mesmo padrão de domainCache
    if (resolved) {
      res.setHeader('X-Alfred-Blog', 'proxy-ok');
      const path = req.path === '/blog' || req.path.startsWith('/blog/')
        ? req.path.slice('/blog'.length) || '/' : req.path;
      await serveBlogPath(resolved.tenant, path, '/blog', req, res, resolved.domain);
      return;
    }
    // token não bate com nada: cai pro fluxo normal, não derruba a plataforma
  }

  const host = resolvedHost(req);
  if (!host || platformHosts.has(host)) return next();
  ...
```

`loadTenantByProxyToken(token)`: `blogDomains.where('proxyToken', '==',
token).where('verified', '==', true).limit(1)`, devolvendo
`{ tenant: Tenant; domain: string } | null` (`domain` é o id do doc — precisa
ser passado explicitamente pro `serveBlogPath`, já que o `Host` real da
requisição é `alfreds.com.br`, não o domínio do cliente). Cardinalidade baixa
(dezenas a poucas centenas de domínios), cache em memória com o mesmo
TTL/tamanho do `domainCache` existente.

O header `X-Alfred-Blog: proxy-ok` é setado **sempre** que uma resposta é
servida por essa via — é o único propósito dele: dar ao endpoint de verificação
um sinal inequívoco de que a cadeia completa (DNS do cliente → gateway dele →
Alfred) está fechada, sem depender do corpo da resposta (que muda com o tema).

`serveBlogPath` ganha um parâmetro opcional `domainOverride` — quando presente
(caso `proxy`), usado no lugar de `resolvedHost(req)` pra `canonicalBase` /
cache key, já que o `Host` real da requisição vai ser `alfreds.com.br`, não o
domínio do cliente.

Nenhuma mudança no ramo `cname`/`X-Forwarded-Host` existente.

## UI (`src/modules/content/blog/BlogDomains.tsx`)

Seletor no topo do formulário de "Adicionar domínio": **"Domínio ou subdomínio
dedicado"** (fluxo atual, inalterado) vs **"Caminho /blog no meu site atual"**
(novo).

Ao escolher o segundo e submeter, a tela mostra:
- O token gerado (copiável), com aviso de que ele autentica esse domínio
  específico e não deve ser reaproveitado em outro lugar.
- Duas instruções prontas pra copiar (ver "Guia de configuração" abaixo): uma
  pra quem vai colocar o domínio na Cloudflare (nosso caso, e o mais simples
  pra maioria dos futuros clientes), outra genérica de reverse proxy pra quem
  já tem um gateway próprio.
- O mesmo botão "Verificar" já existente, agora fazendo a sondagem HTTP.
- Um botão "Gerar novo token" (chama `rotate-token`) pro caso do token vazar
  ou o cliente perder a config.

## Guia de configuração (para o texto de ajuda na própria UI e para uso imediato em omni360agencia.com.br)

**Domínio que vai para a Cloudflare (recomendado pra quem pode trocar nameserver):**
1. Adicionar a zona no Cloudflare; manter o registro DNS atual do domínio
   (A/CNAME pro IP do cPanel) como está, com o proxy (nuvem laranja) ativo —
   nada muda pro tráfego que não é `/blog`. Atenção: a migração de nameserver
   exige reimportar todos os registros existentes (MX, SPF, DKIM, TXT) ou
   e-mail/verificações quebram.
2. Cadastrar o domínio no Alfred com método "Caminho /blog", pegar o token.
3. Criar uma Worker Route escopada a `SEUDOMINIO/blog*` (não wildcard de zona
   — só esse caminho), com um worker mínimo:
   ```js
   export default {
     async fetch(request) {
       const url = new URL(request.url);
       url.hostname = 'alfreds.com.br';
       const headers = new Headers(request.headers);
       headers.set('Host', 'alfreds.com.br');
       headers.set('X-Blog-Domain-Token', '<token gerado>');
       return fetch(new Request(url, { method: request.method, headers, body: request.body, redirect: 'manual' }));
     },
   };
   ```
4. Clicar "Verificar" na UI.

**Domínio que fica onde está, com API Gateway/reverse proxy próprio:**
Mesma ideia, sem tocar em DNS — o gateway já na frente do site atual ganha uma
regra de path `/blog` (e `/blog/*`) que faz reverse proxy pra
`https://alfreds.com.br`, forçando `Host: alfreds.com.br` e
`X-Blog-Domain-Token: <token>`. Exemplos:

- **Nginx:**
  ```
  location /blog {
    proxy_pass https://alfreds.com.br;
    proxy_set_header Host alfreds.com.br;
    proxy_set_header X-Blog-Domain-Token "<token>";
  }
  ```
- **Apache/cPanel (mod_proxy):**
  ```
  ProxyPass /blog https://alfreds.com.br/blog
  ProxyPassReverse /blog https://alfreds.com.br/blog
  RequestHeader set Host "alfreds.com.br"
  RequestHeader set X-Blog-Domain-Token "<token>"
  ```
- **AWS API Gateway (HTTP API):** integração de proxy HTTP em `/blog/{proxy+}`
  apontando pra `https://alfreds.com.br/blog/{proxy}`, com os dois headers
  acima configurados como "Integration request parameters" estáticos.

Em qualquer um dos três, o resto do domínio do cliente continua servido
exatamente como está hoje — só `/blog` é interceptado.

## Segurança

- Token gerado com `crypto.randomBytes(24)` (192 bits), suficiente contra
  força bruta; comparação na query do Firestore, sem timing-safe compare
  necessário (não é comparação em memória, é filtro de índice).
- Vazamento de um token expõe só o domínio associado (serve conteúdo de blog
  já público, com o domínio errado no canonical — no pior caso, um cliente
  vendo o blog de outro sob domínio errado). Não expõe dados privados: tudo
  servido por `blogPublic.ts` já é conteúdo publicado.
- Rotação (`rotate-token`) zera `verified`, forçando reconfirmação — evita
  ficar com o token antigo "verificado" enquanto o novo nunca foi testado.
- Sem rate limit dedicado no endpoint de verify: reusa a autenticação Firebase
  já existente na rota (só o dono do projeto chama).

## Erros e casos de borda

- Token não encontrado ou não verificado → cai pro fluxo normal (não derruba
  request de plataforma nem vaza detalhe do motivo pro chamador).
- Probe de verify sem resposta em 5s → `verified: false`, detail genérico
  pedindo pra conferir se o gateway está apontando certo.
- Dois domínios diferentes tentando o mesmo token → impossível por construção
  (token gerado só no registro, um por doc).

## Testes

Sem suite automatizada no projeto (validação manual via dev server, por
convenção do CLAUDE.md). Verificação manual:
1. Registrar domínio local de teste com `method: 'proxy'`, confirmar token
   retornado.
2. Simular o gateway com `curl -H "Host: alfreds.com.br" -H "X-Blog-Domain-Token: <token>" http://localhost:3000/blog/` e conferir header `X-Alfred-Blog: proxy-ok` e HTML do blog.
3. Chamar `/verify` e confirmar `verified: true` batendo num domínio real
   (omni360agencia.com.br) depois do Worker Route configurado.
4. Confirmar que o fluxo `cname` existente (sem `method` no doc, ou
   `method: 'cname'` explícito) continua idêntico — nenhum teste de regressão
   automatizado, conferir manualmente um domínio CNAME existente se houver.

## Fora de escopo (YAGNI)

- Múltiplos tokens ativos por domínio (ex.: um por ambiente/gateway).
- Rotação automática/expiração por tempo — só manual, sob demanda.
- Rate limiting dedicado no probe de verify além da autenticação Firebase já existente.
