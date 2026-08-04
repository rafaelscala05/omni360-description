import LegalLayout from '../components/LegalLayout';
import { usePageMeta } from '../usePageMeta';

export default function PrivacyPage() {
  usePageMeta({
    title: 'Política de Privacidade | Alfreds',
    description: 'Política de Privacidade da plataforma Alfreds.'
  });

  return (
    <LegalLayout title="Política de Privacidade" updatedAt="17 de julho de 2026">
      <p>
        A presente Política de Privacidade descreve como a Alfreds coleta, utiliza, armazena, compartilha e protege os
        dados pessoais dos usuários e das empresas clientes que utilizam sua plataforma de agentes de inteligência
        artificial para e-commerce. Esta Política está em conformidade com a Lei nº 13.709/2018 (LGPD).
      </p>

      <h2>1. Definições</h2>
      <ul>
        <li>Dado Pessoal: informação relacionada a pessoa natural identificada ou identificável.</li>
        <li>Dado Pessoal Sensível: dado sobre origem racial, convicção religiosa, opinião política, saúde, vida sexual, dado genético ou biométrico.</li>
        <li>Titular: pessoa natural a quem se referem os dados pessoais.</li>
        <li>Controlador: pessoa que toma as decisões referentes ao tratamento de dados pessoais.</li>
        <li>Operador: pessoa que realiza o tratamento de dados em nome do controlador.</li>
        <li>Tratamento: toda operação realizada com dados pessoais.</li>
      </ul>

      <h2>2. Quem Somos e Nosso Papel</h2>
      <p>
        A Alfreds é uma plataforma multiempresas operada pela Omni360 Agência LTDA, inscrita no CNPJ nº
        56.886.959/0001-20, com sede na Avenida Paulista, 1636 — Sala 1504, Bela Vista, São Paulo, SP, CEP 01310-200,
        que disponibiliza agentes de inteligência artificial para apoiar operações de e-commerce. Atua como
        Controladora dos dados cadastrais de Empresas clientes e usuários autorizados, e como Operadora dos dados
        inseridos pela Empresa para operação da própria loja.
      </p>

      <h2>3. Dados que Coletamos</h2>
      <p><strong>3.1 Dados fornecidos diretamente pelo Usuário</strong></p>
      <ul>
        <li>Dados cadastrais: nome, e-mail, telefone, cargo e senha de acesso.</li>
        <li>Dados da Empresa: razão social, CNPJ, segmento de atuação, tom de voz da marca, público-alvo.</li>
        <li>Dados de conexão com serviços de terceiros: credenciais e tokens de API.</li>
        <li>Conteúdo gerado ou aprovado: calendários editoriais, artigos, imagens.</li>
      </ul>
      <p><strong>3.2 Dados coletados automaticamente</strong></p>
      <ul>
        <li>Dados de uso e navegação: páginas acessadas, funcionalidades utilizadas, endereço IP.</li>
        <li>Dados de desempenho dos conteúdos publicados.</li>
        <li>Cookies e tecnologias semelhantes para autenticação e segurança.</li>
      </ul>
      <p><strong>3.3 Múltiplos acessos por usuário</strong></p>
      <p>
        Um mesmo Usuário pode estar vinculado a mais de uma Empresa. Os dados de perfil são compartilhados entre
        ambientes, enquanto os dados operacionais de cada Empresa permanecem segregados.
      </p>

      <h2>4. Finalidades do Tratamento</h2>
      <ul>
        <li>Viabilizar cadastro, autenticação e gerenciamento de contas.</li>
        <li>Personalizar a atuação dos agentes de IA conforme parâmetros da Empresa.</li>
        <li>Gerar sugestões de conteúdo, planos editoriais e artigos automatizados.</li>
        <li>Realizar pesquisas e compilação de conteúdos.</li>
        <li>Publicar conteúdos aprovados em blogs integrados.</li>
        <li>Otimizar cadastro, descrição e SEO de produtos.</li>
        <li>Realizar análises de mercado.</li>
        <li>Garantir segurança da Plataforma e cumprir obrigações legais.</li>
        <li>Enviar comunicações operacionais e notificações.</li>
      </ul>

      <h2>5. Base Legal para o Tratamento</h2>
      <p>O tratamento fundamenta-se em:</p>
      <ul>
        <li>Execução de contrato ou procedimentos preliminares relacionados ao contrato.</li>
        <li>Consentimento do titular, quando aplicável.</li>
        <li>Legítimo interesse da Alfreds para melhoria da Plataforma e segurança.</li>
        <li>Cumprimento de obrigação legal ou regulatória.</li>
      </ul>

      <h2>6. Como Utilizamos Inteligência Artificial</h2>
      <p>
        Os agentes utilizam modelos de IA e mecanismos de pesquisa para gerar conteúdos. Os dados fornecidos pela
        Empresa podem ser processados por provedores de infraestrutura contratados, sob obrigações de
        confidencialidade. Nenhum conteúdo gerado automaticamente é publicado sem passar pelas etapas de revisão antes
        da publicação.
      </p>

      <h2>7. Compartilhamento de Dados</h2>
      <p>A Alfreds pode compartilhar dados em:</p>
      <ul>
        <li>Provedores de infraestrutura tecnológica e nuvem.</li>
        <li>Plataformas de publicação integradas pelo Cliente.</li>
        <li>Autoridades públicas mediante requisição legal.</li>
        <li>Operações societárias como fusão ou aquisição.</li>
      </ul>
      <p>A Alfreds não comercializa dados pessoais a terceiros.</p>

      <h2>8. Armazenamento e Segurança</h2>
      <p>
        Os dados são armazenados em ambiente de nuvem com criptografia em trânsito, controle de acesso e segregação
        lógica entre Empresas. Credenciais de integração são protegidas. A empresa adota medidas técnicas compatíveis
        com melhores práticas de mercado.
      </p>

      <h2>9. Retenção e Eliminação dos Dados</h2>
      <p>
        Dados serão mantidos pelo período necessário ao cumprimento das finalidades ou conforme exigências legais.
        Após término da relação contratual, dados poderão ser eliminados ou anonimizados.
      </p>

      <h2>10. Direitos do Titular</h2>
      <p>Sob a LGPD, o titular pode solicitar:</p>
      <ul>
        <li>Confirmação da existência de tratamento.</li>
        <li>Acesso, correção ou atualização de dados.</li>
        <li>Anonimização, bloqueio ou eliminação de dados desnecessários.</li>
        <li>Portabilidade dos dados.</li>
        <li>Eliminação de dados tratados com base em consentimento.</li>
        <li>Informação sobre compartilhamento de dados.</li>
        <li>Revogação do consentimento.</li>
      </ul>

      <h2>11. Cookies e Tecnologias de Rastreamento</h2>
      <p>
        A Plataforma utiliza cookies próprios e de terceiros para autenticação, sessões ativas e análise de uso.
        Usuários podem gerenciar preferências nas configurações do navegador.
      </p>

      <h2>12. Transferência Internacional de Dados</h2>
      <p>
        Dados podem ser transferidos e processados em servidores fora do Brasil. A Alfreds adota mecanismos e
        cláusulas contratuais adequados para assegurar proteção compatível com a LGPD.
      </p>

      <h2>13. Alterações desta Política</h2>
      <p>
        A Política pode ser atualizada periodicamente. A versão vigente permanecerá disponível na Plataforma com
        indicação da data de atualização. Alterações relevantes serão comunicadas aos usuários.
      </p>

      <h2>14. Contato e Encarregado de Dados (DPO)</h2>
      <p>
        Para dúvidas ou solicitações: <a href="mailto:privacidade@alfreds.ai">privacidade@alfreds.ai</a>
      </p>
    </LegalLayout>
  );
}
