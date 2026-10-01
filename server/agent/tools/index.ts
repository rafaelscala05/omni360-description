// Registra todas as ferramentas do agente no registry. Importado pelo grafo
// (contentGraph.ts) e pelo servidor principal (routes.ts): sem isto o registry
// do servidor principal ficava vazio — GET /api/agent/tools devolvia zero
// ferramentas e a aprovação de um lote (loteRoutes.ts) não acharia o execute().
import './content';
import './contentSeo';
import './contentBlog';
import './wake';
import './tiny';
import './erps';
import './discovery';
import './produtos';
import './planilha';
import './meli';
