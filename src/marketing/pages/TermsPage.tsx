import LegalLayout from '../components/LegalLayout';
import { usePageMeta } from '../usePageMeta';

export default function TermsPage() {
  usePageMeta({
    title: 'Termos de Serviço | Alfreds',
    description: 'Termos de Serviço da plataforma Alfreds.'
  });

  return (
    <LegalLayout title="Termos de Serviço" updatedAt="17 de julho de 2026">
      <p>
        Estes Termos de Serviço ("Termos") regulam o acesso e uso da plataforma Alfreds, incluindo seus agentes de
        inteligência artificial ("Serviço", "Plataforma" ou "Alfreds"), disponibilizados por Omni360 Agência LTDA,
        inscrita no CNPJ nº 56.886.959/0001-20, com sede na Avenida Paulista, 1636 — Sala 1504, Bela Vista, São Paulo,
        SP, CEP 01310-200 ("Alfreds", "nós" ou "nossa empresa"). Ao criar uma conta, acessar ou utilizar a Plataforma,
        você ("Cliente", "Usuário" ou "você"), em nome próprio ou de uma pessoa jurídica que representa, declara ter
        lido, compreendido e aceitado integralmente estes Termos.
      </p>

      <h2>1. Definições</h2>
      <ul>
        <li>Plataforma: o software Alfreds, acessível via web, que disponibiliza agentes de IA para gestão de e-commerce.</li>
        <li>
          Agentes de IA: módulos automatizados da Plataforma, incluindo, sem limitação, o Agente de Marketing de
          Conteúdo, o Agente de Produtos, o Agente de Força de Vendas e o Agente Operacional.
        </li>
        <li>Empresa/Conta: a organização cadastrada na Plataforma, em estrutura multiempresas, à qual um ou mais Usuários possuem acesso.</li>
        <li>
          Conteúdo do Cliente: dados, textos, imagens, produtos, credenciais de integração e demais materiais fornecidos
          pelo Cliente ou coletados a partir de suas plataformas conectadas (ex.: WordPress, marketplaces, ERPs).
        </li>
        <li>
          Conteúdo Gerado: artigos, descrições, imagens, vídeos, calendários editoriais e demais materiais produzidos
          pelos Agentes de IA a partir do Conteúdo do Cliente.
        </li>
      </ul>

      <h2>2. Objeto do Serviço</h2>
      <p>
        A Alfreds fornece uma plataforma de agentes de inteligência artificial voltada à automação de processos de
        e-commerce, incluindo, conforme o plano contratado:
      </p>
      <ul>
        <li>Criação e gestão de conteúdo de marketing (pesquisa, redação, geração de imagens e publicação automatizada em blog integrado, como WordPress);</li>
        <li>Otimização de cadastro de produtos (descrições, SEO, fotos e vídeos);</li>
        <li>Gestão de força de vendas, afiliados, links e campanhas;</li>
        <li>Automação de tarefas operacionais da loja, como atualização de preços, estoques, banners e fretes.</li>
      </ul>
      <p>
        A disponibilidade de cada Agente de IA pode variar conforme o plano contratado. Funcionalidades descritas como
        "em construção" podem não estar disponíveis em todos os momentos e estão sujeitas a alterações sem aviso prévio.
      </p>

      <h2>3. Cadastro, Conta e Estrutura Multiempresas</h2>
      <ul>
        <li>
          A Plataforma adota estrutura multiempresas, permitindo que um mesmo Usuário possua acesso a múltiplas Empresas
          e que uma Empresa possua múltiplos Usuários, cada qual com o respectivo nível de permissão definido pelo
          administrador da conta.
        </li>
        <li>O Cliente é responsável por manter a exatidão, veracidade e atualização dos dados cadastrais, bem como pela guarda de suas credenciais de acesso.</li>
        <li>O Cliente é integralmente responsável por qualquer atividade realizada em sua Conta, inclusive por Usuários que ele autorizar a acessá-la.</li>
        <li>A Alfreds pode suspender ou encerrar contas que apresentem dados falsos, uso indevido ou violação destes Termos.</li>
      </ul>

      <h2>4. Integrações com Terceiros</h2>
      <p>
        A utilização de determinados Agentes de IA depende da conexão do Cliente com serviços de terceiros (ex.:
        WordPress, marketplaces, gateways de imagem e pesquisa, provedores de infraestrutura em nuvem). Ao configurar
        tais integrações — incluindo URLs, chaves de API e credenciais —, o Cliente:
      </p>
      <ul>
        <li>Declara possuir autorização legítima para conceder à Alfreds acesso a essas contas e sistemas;</li>
        <li>Reconhece que a Alfreds não se responsabiliza por indisponibilidades, alterações ou falhas nos serviços de terceiros;</li>
        <li>Autoriza a Alfreds a realizar chamadas automatizadas (leitura e publicação) nesses sistemas em seu nome, exclusivamente para a execução das funcionalidades contratadas.</li>
      </ul>

      <h2>5. Conteúdo Gerado por Inteligência Artificial</h2>
      <ul>
        <li>
          Os Agentes de IA utilizam modelos de inteligência artificial para pesquisar, compilar, redigir, revisar e
          publicar conteúdo. Embora a Plataforma inclua etapas de revisão automatizada, a Alfreds não garante que o
          Conteúdo Gerado esteja livre de imprecisões, erros factuais ou de conformidade legal.
        </li>
        <li>
          É de responsabilidade do Cliente revisar e aprovar o Conteúdo Gerado antes de sua publicação, quando a
          Plataforma oferecer fluxo de aprovação, bem como garantir que ele esteja de acordo com a legislação
          aplicável, direitos de terceiros e políticas das plataformas em que for publicado.
        </li>
        <li>Quando configurada a publicação automática, o Cliente assume o risco decorrente da publicação de Conteúdo Gerado sem revisão humana prévia.</li>
        <li>A Alfreds não garante resultados específicos de tráfego, vendas, posicionamento em buscadores (SEO) ou desempenho comercial decorrentes do uso da Plataforma.</li>
      </ul>

      <h2>6. Propriedade Intelectual</h2>
      <ul>
        <li>A Alfreds é titular de todos os direitos sobre a Plataforma, sua marca, tecnologia, agentes de IA, interface e demais elementos de propriedade intelectual associados ao Serviço.</li>
        <li>
          O Conteúdo do Cliente permanece de propriedade do Cliente. Ao utilizá-lo na Plataforma, o Cliente concede à
          Alfreds licença limitada, não exclusiva, para processá-lo unicamente com a finalidade de prestar o Serviço.
        </li>
        <li>
          Salvo disposição em contrário no plano contratado, o Conteúdo Gerado a partir do Conteúdo do Cliente pertence
          ao Cliente, uma vez publicado ou entregue, observadas eventuais licenças de ferramentas de terceiros
          utilizadas na geração de imagens ou vídeos.
        </li>
      </ul>

      <h2>7. Planos, Pagamento e Cancelamento</h2>
      <ul>
        <li>O acesso à Plataforma está condicionado à contratação de um plano pago, cujos valores, limites de uso e funcionalidades constam na proposta comercial ou página de preços vigente.</li>
        <li>Os pagamentos são processados conforme a periodicidade contratada (mensal ou anual) e podem sofrer reajuste mediante aviso prévio de 30 (trinta) dias.</li>
        <li>O Cliente pode cancelar sua assinatura a qualquer momento, sendo o cancelamento efetivado ao final do ciclo de cobrança vigente, salvo disposição contratual específica sobre reembolsos.</li>
        <li>O não pagamento pode acarretar a suspensão ou o encerramento do acesso à Plataforma.</li>
      </ul>

      <h2>8. Privacidade e Proteção de Dados</h2>
      <p>
        O tratamento de dados pessoais realizado pela Alfreds observa a Lei nº 13.709/2018 (Lei Geral de Proteção de
        Dados — LGPD) e está detalhado em Política de Privacidade específica, parte integrante destes Termos. Ao
        utilizar a Plataforma, o Cliente declara estar ciente de que dados de sua empresa, de seus clientes finais e de
        conteúdos publicados poderão ser processados, inclusive por meio de serviços de inteligência artificial e
        mecanismos de busca, para a execução do Serviço.
      </p>

      <h2>9. Obrigações do Cliente</h2>
      <ul>
        <li>Utilizar a Plataforma de forma lícita, ética e em conformidade com estes Termos e a legislação aplicável;</li>
        <li>Não utilizar os Agentes de IA para gerar conteúdo ilegal, difamatório, discriminatório, enganoso ou que viole direitos de terceiros;</li>
        <li>Não realizar engenharia reversa, cópia, revenda ou exploração não autorizada da tecnologia da Plataforma;</li>
        <li>Fornecer informações verdadeiras sobre sua empresa, produtos e tom de voz para o correto funcionamento dos Agentes de IA.</li>
      </ul>

      <h2>10. Limitação de Responsabilidade</h2>
      <p>
        Na máxima extensão permitida pela legislação aplicável, a Alfreds não se responsabiliza por danos indiretos,
        lucros cessantes, perda de dados ou de oportunidades de negócio decorrentes do uso ou da impossibilidade de uso
        da Plataforma, incluindo aqueles originados de Conteúdo Gerado por IA, falhas em integrações de terceiros ou
        indisponibilidade temporária do Serviço. A responsabilidade total da Alfreds, quando aplicável, está limitada
        ao valor pago pelo Cliente nos 3 (três) meses anteriores ao evento que originou o dano.
      </p>

      <h2>11. Disponibilidade e Alterações no Serviço</h2>
      <p>
        A Alfreds envidará esforços razoáveis para manter a Plataforma disponível, podendo realizar manutenções
        programadas ou emergenciais, com ou sem aviso prévio. Novas funcionalidades, incluindo agentes ainda em
        desenvolvimento (como os Agentes de Força de Vendas e Operacional), poderão ser lançadas, alteradas ou
        descontinuadas a qualquer tempo.
      </p>

      <h2>12. Rescisão</h2>
      <p>
        A Alfreds pode suspender ou encerrar o acesso do Cliente à Plataforma, a qualquer tempo, em caso de violação
        destes Termos, inadimplência ou uso indevido do Serviço, sem prejuízo de outras medidas cabíveis. O Cliente
        pode encerrar sua conta a qualquer momento, observadas as condições da Seção 7.
      </p>

      <h2>13. Alterações destes Termos</h2>
      <p>
        Estes Termos poderão ser atualizados periodicamente. Alterações relevantes serão comunicadas ao Cliente por
        e-mail ou por aviso na própria Plataforma, com antecedência razoável. A continuidade do uso do Serviço após a
        entrada em vigor das alterações constitui aceitação dos novos Termos.
      </p>

      <h2>14. Legislação Aplicável e Foro</h2>
      <p>
        Estes Termos são regidos pelas leis da República Federativa do Brasil. Fica eleito o foro da comarca de
        São Paulo/SP, com renúncia a qualquer outro, por mais privilegiado que seja, para dirimir eventuais
        controvérsias oriundas destes Termos.
      </p>

      <h2>15. Contato</h2>
      <p>
        Em caso de dúvidas sobre estes Termos, entre em contato pelo e-mail{' '}
        <a href="mailto:tech@alfreds.com.br">tech@alfreds.com.br</a> ou pelos canais de suporte disponíveis na
        Plataforma.
      </p>
    </LegalLayout>
  );
}
