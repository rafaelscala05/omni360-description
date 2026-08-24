// Worker da borda dos domínios de blog dos clientes (Cloudflare for SaaS).
//
// Existe por um motivo só: o App Hosting recusa com 404 qualquer Host que não
// esteja registrado no backend, e a Cloudflare encaminha o Host original do
// cliente para o fallback origin. Este Worker desfaz o impasse — viaja com o
// Host que o App Hosting aceita e carrega o domínio real em X-Forwarded-Host,
// que é o que server/blogPublic.ts usa para resolver o tenant.
//
// Rota: */*  — precisa ser o wildcard da zona inteira. Uma rota em
// blogs.alfreds.com.br/* NÃO pega o tráfego dos custom hostnames: as rotas de
// Worker casam pelo hostname que chega (blog.cliente.com.br), não pelo fallback
// origin. Por isso o wildcard, com os hosts da própria plataforma excluídos
// logo abaixo.
//
// Secret: BLOG_PROXY_SECRET — precisa ser idêntico ao do App Hosting.

const ORIGIN = 'alfreds--project-95918f0d-50bb-4f66-a0d.us-east4.hosted.app';

// Hosts que já são da plataforma: seguem para o origin sem nenhuma reescrita.
// O app principal não pode passar pela lógica de blog.
const PLATFORM_HOSTS = new Set([
  'alfreds.com.br',
  'www.alfreds.com.br',
  'blogs.alfreds.com.br',
]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const clientHost = url.hostname;

    if (PLATFORM_HOSTS.has(clientHost)) return fetch(request);

    url.hostname = ORIGIN; // blog.cliente.com.br -> host que o App Hosting aceita

    const headers = new Headers(request.headers);
    headers.set('X-Forwarded-Host', clientHost);
    headers.set('X-Forwarded-Proto', 'https');
    if (env.BLOG_PROXY_SECRET) headers.set('X-Blog-Proxy-Secret', env.BLOG_PROXY_SECRET);

    return fetch(new Request(url, {
      method: request.method,
      headers,
      body: request.body,
      redirect: 'manual',
    }));
  },
};
