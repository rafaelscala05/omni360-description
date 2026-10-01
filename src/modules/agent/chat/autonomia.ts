import { fetchAgentSettings } from '../../../services/agentChatService';

// As travas fixas (publicar, credencial…) vêm do servidor uma vez por sessão:
// nelas o "aprovar sozinho" não aparece, porque o servidor ignoraria.
let travasCache: Promise<{ travas: Set<string>; auto: Set<string> }> | null = null;
export function carregarAutonomia() {
  travasCache ??= fetchAgentSettings()
    .then(({ settings, travas }) => ({
      travas: new Set(travas),
      auto: new Set(Object.entries(settings.toolOverrides ?? {}).filter(([, m]) => m === 'auto').map(([t]) => t)),
    }))
    .catch(() => { travasCache = null; return { travas: new Set<string>(), auto: new Set<string>() }; });
  return travasCache;
}

/** Nome da ação para o "Próximas … : aprovar sozinho". */
export function rotuloAutonomia(tool: string): string {
  if (tool === 'produtos.descricoes.gerar') return 'Próximas descrições';
  if (tool === 'produtos.atributos.gerar') return 'Próximos atributos';
  if (tool === 'produtos.ambientadas.gerar') return 'Próximas imagens ambientadas';
  if (tool.startsWith('wake.') || tool.startsWith('tiny.')) return 'Próximas alterações deste tipo';
  return 'Próximas vezes';
}


/** Depois de mudar a autonomia, a próxima leitura volta ao servidor. */
export function esquecerAutonomia(): void {
  travasCache = null;
}
