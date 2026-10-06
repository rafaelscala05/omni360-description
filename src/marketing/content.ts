// Copy do site. As páginas de objetivo seguem os três objetivos da Tela 0 do
// onboarding (`OBJETIVO_INFO`): quem chega por uma delas cria a conta com o
// objetivo já marcado (ver `objetivoSite.ts`).

import type { Objetivo } from '../modules/agent/capacidades';

export interface FaqItem {
  q: string;
  a: string;
}

export interface CaseItem {
  metric: string;
  label: string;
  description: string;
}

export interface SegmentItem {
  title: string;
  pain: string;
}

export interface Bloco {
  titulo: string;
  texto: string;
}

export interface Recurso extends Bloco {
  /** Token de cor do aspecto (o mesmo do app). */
  cor: string;
}

export interface PaginaObjetivo {
  objetivo: Objetivo;
  cor: string;
  meta: { title: string; description: string };
  selo: string;
  h1: string;
  sub: string;
  cta: string;
  verDemo: string;
  dores: { titulo: string; itens: Bloco[] };
  demo: { titulo: string; texto: string };
  passos: Bloco[];
  recursos: { titulo: string; texto: string; itens: Recurso[] };
  garantia: Bloco;
  faq: FaqItem[];
  final: { titulo: string; texto: string };
}

const FAQ_CUSTO: FaqItem = {
  q: 'Quanto custa?',
  a: 'Você paga em créditos, sem mensalidade. Cada ação mostra o custo antes de você confirmar, e a conta nova começa com 10 créditos grátis.',
};

export const PAGINAS: Record<Objetivo, PaginaObjetivo> = {
  produto: {
    objetivo: 'produto',
    cor: 'var(--ag-orig-produto)',
    meta: {
      title: 'Descrições de produto com IA para o catálogo inteiro | Alfreds',
      description:
        'O Alfred escreve descrição, SEO e atributos de cada produto, gera fotos ambientadas e envia para o seu ERP. Você revisa antes de gravar. Comece com 10 créditos grátis.',
    },
    selo: 'Agente de Produto',
    h1: 'Cada produto do seu catálogo com uma descrição que vende.',
    sub: 'Cole o link de um produto ou suba a planilha. O Alfred escreve descrição, SEO e atributos na voz da sua marca, cria fotos ambientadas e envia tudo para o seu ERP. Nada é gravado sem você revisar.',
    cta: 'Melhorar minhas descrições',
    verDemo: 'Ver um antes e depois',
    dores: {
      titulo: 'Produto sem descrição não aparece no Google e não convence quem chega.',
      itens: [
        { titulo: 'Metade do catálogo veio do ERP só com o nome.', texto: 'Sem texto, o Google não tem o que indexar e o cliente não tem motivo para comprar.' },
        { titulo: 'Escrever 300 descrições toma um mês de alguém.', texto: 'E quando termina, já chegou outra leva de produtos novos.' },
        { titulo: 'Foto em fundo branco não mostra o produto em uso.', texto: 'Quem compra pela tela quer se imaginar usando.' },
      ],
    },
    demo: {
      titulo: 'O mesmo produto, antes e depois do Alfred.',
      texto: 'Um exemplo do que sai da primeira geração: texto, título de busca, atributos da categoria e fotos.',
    },
    passos: [
      { titulo: 'Mostre um produto', texto: 'Cole o link da sua loja ou suba a planilha. Ou conecte Tiny, Bling, IdWorks ou Wake e traga o catálogo inteiro.' },
      { titulo: 'O Alfred escreve', texto: 'Descrição, título SEO, meta description e os atributos que a categoria pede, no tom que você escolher.' },
      { titulo: 'Você aprova e envia', texto: 'Revise o antes e depois, aprove e mande para o ERP. Mudou de ideia? Desfaça o lote inteiro.' },
    ],
    recursos: {
      titulo: 'Tudo o que um produto precisa para vender.',
      texto: 'Um produto de cada vez ou 50 de uma vez, sempre com o custo à vista antes de confirmar.',
      itens: [
        { titulo: 'Descrição e SEO', texto: 'Texto persuasivo, título e meta description para busca, sem inventar especificação.', cor: 'var(--ag-asp-descricao)' },
        { titulo: 'Atributos da categoria', texto: 'Material, medida, voltagem e o que mais a categoria exigir, dentro das opções do seu cadastro.', cor: 'var(--ag-asp-atributos)' },
        { titulo: 'Fotos ambientadas', texto: 'Três cenas realistas do produto em uso, a partir da foto que você já tem.', cor: 'var(--ag-asp-imagem)' },
        { titulo: 'Vídeo do produto', texto: 'Vídeo curto feito das suas fotos reais, com narração e trilha. Ou com um apresentador de IA falando do produto.', cor: 'var(--ag-asp-video)' },
        { titulo: 'Em massa', texto: 'Selecione o catálogo, veja quantos já têm descrição e gere só o que falta.', cor: 'var(--ag-accent)' },
        { titulo: 'Direto no ERP', texto: 'Título, descrição, SEO e imagens vão para Tiny, Bling, IdWorks ou Wake com um clique.', cor: 'var(--ag-blue)' },
      ],
    },
    garantia: {
      titulo: 'O fiscal fica intocado.',
      texto: 'Ao enviar para o ERP, o Alfred grava só título, descrição, SEO e imagens. NCM, GTIN, CEST, peso, medidas e preço continuam exatamente como estão.',
    },
    faq: [
      { q: 'Funciona com a minha plataforma?', a: 'Com qualquer loja, por planilha ou link do produto. Com Tiny, Bling, IdWorks e Wake, o Alfred lê e grava direto, sem planilha no meio.' },
      { q: 'A descrição vai sair genérica?', a: 'O Alfred parte dos dados do próprio produto e da categoria, e você escolhe o tom. Ele não inventa especificação: o que não sabe, deixa de fora.' },
      { q: 'Posso revisar antes de publicar?', a: 'Sim. Nada é gravado sem a sua aprovação, item por item ou em lote. Um lote em massa ainda pode ser desfeito depois.' },
      FAQ_CUSTO,
    ],
    final: {
      titulo: 'Comece pelo produto que mais vende e veja a diferença hoje.',
      texto: 'Cole um link e receba a primeira descrição em minutos.',
    },
  },

  meli: {
    objetivo: 'meli',
    cor: 'var(--ag-orig-meli)',
    meta: {
      title: 'Otimização de anúncios do Mercado Livre com IA | Alfreds',
      description:
        'O Alfred reescreve título e ficha técnica dos seus anúncios, cria capa, fotos e vídeo. Você aprova cada proposta antes de publicar. Comece com 10 créditos grátis.',
    },
    selo: 'Agente Mercado Livre',
    h1: 'Anúncios no Mercado Livre que aparecem na busca e convencem no clique.',
    sub: 'O Alfred lê seus anúncios, reescreve título e ficha técnica com o que o comprador procura, cria capa, fotos ambientadas e vídeo. Você aprova cada proposta antes de qualquer coisa ir ao ar.',
    cta: 'Otimizar meus anúncios',
    verDemo: 'Ver um anúncio otimizado',
    dores: {
      titulo: 'Anúncio incompleto perde para o concorrente que vende o mesmo produto.',
      itens: [
        { titulo: 'Título curto não aparece na busca.', texto: 'Sem marca, modelo e medida, o comprador nunca chega até o seu anúncio.' },
        { titulo: 'Ficha técnica pela metade derruba a exposição.', texto: 'O Mercado Livre favorece anúncios com os atributos da categoria preenchidos.' },
        { titulo: 'Suas fotos são as mesmas de todo mundo.', texto: 'Quando dez vendedores usam a foto do fabricante, ganha quem mostra mais.' },
      ],
    },
    demo: {
      titulo: 'Um anúncio, antes e depois da proposta do Alfred.',
      texto: 'É assim que cada proposta chega para você: o atual e o sugerido, lado a lado.',
    },
    passos: [
      { titulo: 'Conecte sua conta', texto: 'Autorize o Alfred pelo login oficial do Mercado Livre. Ele lê seus anúncios sem mudar nada.' },
      { titulo: 'Receba as propostas', texto: 'Para cada anúncio: título novo, atributos que faltam, capa e fotos, ao lado do que está no ar.' },
      { titulo: 'Publique o que aprovar', texto: 'Só vai para o Mercado Livre o que você aprovar, anúncio por anúncio.' },
    ],
    recursos: {
      titulo: 'O anúncio inteiro, não só o título.',
      texto: 'Cada proposta mexe no que pesa na busca e na decisão de compra.',
      itens: [
        { titulo: 'Título que o comprador busca', texto: 'Marca, modelo, medida e o diferencial, dentro do limite de caracteres da categoria.', cor: 'var(--ag-asp-descricao)' },
        { titulo: 'Ficha técnica completa', texto: 'Preenche os atributos que a categoria pede e que hoje estão vazios.', cor: 'var(--ag-asp-atributos)' },
        { titulo: 'Capa e fotos ambientadas', texto: 'Uma capa limpa e cenas do produto em uso, a partir das suas fotos.', cor: 'var(--ag-asp-imagem)' },
        { titulo: 'Vídeo do anúncio', texto: 'Gera um vídeo curto do produto e já vincula ao anúncio.', cor: 'var(--ag-asp-video)' },
        { titulo: 'Nota de cada anúncio', texto: 'A nota do Mercado Livre, a do Alfred e as visitas dos últimos 30 dias, para saber por onde começar.', cor: 'var(--ag-accent)' },
        { titulo: 'Um clique para publicar', texto: 'Aprovou a proposta? O Alfred publica e mostra o que mudou.', cor: 'var(--ag-orig-meli)' },
      ],
    },
    garantia: {
      titulo: 'Publicar é sempre com você.',
      texto: 'O Alfred nunca publica sozinho no Mercado Livre, nem com o modo automático ligado. A conexão é pela autorização oficial e pode ser revogada quando você quiser.',
    },
    faq: [
      { q: 'O Alfred altera meus anúncios sozinho?', a: 'Não. Ele monta propostas, você revisa e só publica o que aprovar. Essa trava vale até no modo automático.' },
      { q: 'Preciso passar minha senha do Mercado Livre?', a: 'Não. A conexão é pela autorização oficial do Mercado Livre, que você pode revogar a qualquer momento.' },
      { q: 'Também vendo em loja própria. Serve para mim?', a: 'Sim. O mesmo Alfred cuida das descrições da sua loja e do seu blog, na mesma conta e com os mesmos créditos.' },
      FAQ_CUSTO,
    ],
    final: {
      titulo: 'O seu concorrente já otimizou o anúncio dele. Agora é a sua vez.',
      texto: 'Conecte a conta e veja as primeiras propostas em minutos.',
    },
  },

  conteudo: {
    objetivo: 'conteudo',
    cor: 'var(--ag-orig-conteudo)',
    meta: {
      title: 'Blog com IA para e-commerce, na voz da sua marca | Alfreds',
      description:
        'O Alfred lê o seu site, planeja os temas, monta o calendário e escreve artigos que levam o leitor aos seus produtos. Comece com 10 créditos grátis.',
    },
    selo: 'Agente de Conteúdo',
    h1: 'Um blog que traz cliente do Google, sem você escrever uma linha.',
    sub: 'O Alfred lê o seu site, descobre os temas que a sua loja pode dominar, monta o calendário e escreve os artigos na voz da sua marca, com link para os seus produtos. Você aprova e o blog publica.',
    cta: 'Montar meu blog',
    verDemo: 'Ver um plano de conteúdo',
    dores: {
      titulo: 'Todo mundo sabe que precisa de um blog. Ninguém tem tempo de escrever.',
      itens: [
        { titulo: 'O último artigo é de dois anos atrás.', texto: 'O Google e os clientes percebem quando um blog parou.' },
        { titulo: 'Pauta solta não ranqueia.', texto: 'Artigo sem estratégia vira texto que ninguém encontra.' },
        { titulo: 'Agência de conteúdo é cara e demora.', texto: 'E ainda leva meses para aprender a falar como a sua marca.' },
      ],
    },
    demo: {
      titulo: 'Do seu site a um mês de artigos planejados.',
      texto: 'Um exemplo do plano que o Alfred monta para uma loja de mochilas e malas.',
    },
    passos: [
      { titulo: 'Informe o seu site', texto: 'O Alfred lê suas páginas e entende o que você vende, para quem e em que tom.' },
      { titulo: 'Aprove o plano', texto: 'Ele organiza os temas em grupos e monta um calendário de publicação. Você ajusta o que quiser.' },
      { titulo: 'Receba os artigos', texto: 'Textos otimizados para busca, com imagem de capa e links para os seus produtos, prontos para publicar.' },
    ],
    recursos: {
      titulo: 'Uma redação inteira trabalhando para a sua loja.',
      texto: 'Do diagnóstico à publicação, sem você abrir um editor de texto.',
      itens: [
        { titulo: 'Perfil da marca', texto: 'Tom de voz, público e diferenciais, lidos do seu site e ajustáveis por você.', cor: 'var(--ag-orig-conteudo)' },
        { titulo: 'Mapa de temas', texto: 'Os assuntos que a sua loja pode dominar, organizados em artigo principal e satélites.', cor: 'var(--ag-asp-atributos)' },
        { titulo: 'Calendário editorial', texto: 'O que publicar e quando, para manter a constância que o Google valoriza.', cor: 'var(--ag-blue)' },
        { titulo: 'Artigos na sua voz', texto: 'Texto otimizado para busca, com imagem de capa e link para os produtos certos.', cor: 'var(--ag-asp-descricao)' },
        { titulo: 'Blog pronto', texto: 'Um blog no seu domínio, com a sua aparência. Se você usa WordPress, o Alfred publica lá.', cor: 'var(--ag-asp-imagem)' },
        { titulo: 'Diagnóstico de busca', texto: 'Por quais palavras o seu site já aparece e onde está a oportunidade.', cor: 'var(--ag-accent)' },
      ],
    },
    garantia: {
      titulo: 'Nada vai ao ar sem a sua leitura.',
      texto: 'Cada artigo passa pela sua revisão. Publicar e despublicar são ações que o Alfred só faz com o seu ok, mesmo no modo automático.',
    },
    faq: [
      { q: 'Os artigos vão parecer escritos por um robô?', a: 'O Alfred aprende o tom a partir do seu site e segue as regras da sua marca. E cada artigo passa pela sua revisão antes de ir ao ar.' },
      { q: 'Preciso já ter um blog?', a: 'Não. O Alfred monta um blog no seu domínio. Se você já usa WordPress, ele publica lá.' },
      { q: 'Em quanto tempo vejo resultado?', a: 'Conteúdo leva semanas para ganhar posição no Google. O que o Alfred elimina é o tempo de produzir com constância, que é onde quase todo blog para.' },
      FAQ_CUSTO,
    ],
    final: {
      titulo: 'Seu blog pode publicar o primeiro artigo ainda esta semana.',
      texto: 'Informe o seu site e receba o plano de conteúdo em minutos.',
    },
  },
};

export const homeFaq: FaqItem[] = [
  {
    q: 'O que é o Alfred?',
    a: 'Um agente de IA para e-commerce. Ele lê as fontes da sua loja (catálogo, ERP, Mercado Livre e site), monta a lista de tarefas da semana e executa: descrições, atributos, fotos, vídeos, anúncios e artigos. Você conversa com ele em português e aprova o que ele propõe.',
  },
  {
    q: 'Ele mexe na minha loja sem eu saber?',
    a: 'Não. Toda gravação passa por você: o Alfred mostra o antes e depois e só grava o que você aprovar. Se quiser, você libera ações específicas para rodarem no automático.',
  },
  { q: 'Preciso de cartão para começar?', a: 'Não. A conta nova começa com 10 créditos grátis para testar.' },
  {
    q: 'Com quais plataformas funciona?',
    a: 'Tiny, Bling, IdWorks, Wake e Mercado Livre por integração direta. Qualquer outra loja por planilha ou link de produto.',
  },
  { q: 'Como funciona a cobrança?', a: 'Por créditos, sem mensalidade e sem fidelidade. Cada ação mostra o custo antes de você confirmar.' },
  {
    q: 'Meus dados ficam seguros?',
    a: 'As chaves de IA e das integrações ficam no servidor, nunca no navegador, e seus dados não são compartilhados com terceiros.',
  },
];

export const segments: SegmentItem[] = [
  { title: 'Loja online', pain: 'Catálogo grande, equipe pequena: o Alfred escreve, ambienta e envia ao ERP em lote.' },
  { title: 'Marketplace / Seller', pain: 'Anúncios completos no Mercado Livre, com título, ficha técnica e fotos que disputam a busca.' },
  { title: 'Indústria', pain: 'Fichas técnicas viram cadastros e conteúdo prontos para os seus revendedores.' },
];

export const cases: CaseItem[] = [
  { metric: '−90%', label: 'Tempo por produto', description: 'De uma tarde inteira para minutos por item. Exemplo ilustrativo.' },
  { metric: '10×', label: 'Mais itens por dia', description: 'A mesma equipe publica muito mais, sem contratar. Exemplo ilustrativo.' },
  { metric: '50', label: 'Produtos por lote', description: 'Descrição, SEO e atributos gerados juntos e revisados de uma vez.' },
];
