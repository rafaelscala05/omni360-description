// scripts/verify-ugc-video-script.mjs
//
// Verificação da lógica pura de roteiro UGC (server/ugcVideoAgent.ts).
// Não chama Gemini nem sobe servidor.
// Rodar com: npx tsx scripts/verify-ugc-video-script.mjs
import { buildUgcScriptPrompt, validateUgcScript, buildUgcClipPrompt } from '../server/ugcVideoAgent.ts';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  ok' : 'FALHA'}  ${label}${ok ? '' : ` → esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`}`);
}

const prompt = buildUgcScriptPrompt({
  description: 'Fone de ouvido bluetooth com cancelamento de ruído',
  brand: 'Acme',
  productName: 'Fone XPTO',
  category: 'Eletrônicos',
  attributes: { Cor: 'Preto', Bateria: '20h' },
  avatarDescricao: 'Mulher jovem, 25 anos, estilo casual',
});
check('prompt inclui a descrição do avatar', prompt.includes('Mulher jovem, 25 anos, estilo casual'), true);
check('prompt inclui o nome do produto', prompt.includes('Fone XPTO'), true);
check('prompt pede de 2 a 3 clipes', prompt.includes('2 a 3 clipes'), true);

check('script válido com 2 clipes', validateUgcScript({
  cena: 'sala',
  avatarDescricao: 'x',
  clipes: [
    { papel: 'gancho', fala: 'Olha isso', acaoVisual: 'segura o produto' },
    { papel: 'demonstracao', fala: 'Muito bom', acaoVisual: 'usa o produto' },
  ],
}), true);

check('script válido com 3 clipes', validateUgcScript({
  cena: 'sala',
  avatarDescricao: 'x',
  clipes: [
    { papel: 'gancho', fala: 'a', acaoVisual: 'b' },
    { papel: 'demonstracao', fala: 'a', acaoVisual: 'b' },
    { papel: 'cta', fala: 'a', acaoVisual: 'b' },
  ],
}), true);

check('rejeita com 1 clipe só', validateUgcScript({
  cena: 'sala',
  avatarDescricao: 'x',
  clipes: [{ papel: 'gancho', fala: 'a', acaoVisual: 'b' }],
}), false);

check('rejeita com 4 clipes', validateUgcScript({
  cena: 'sala',
  avatarDescricao: 'x',
  clipes: [
    { papel: 'gancho', fala: 'a', acaoVisual: 'b' },
    { papel: 'demonstracao', fala: 'a', acaoVisual: 'b' },
    { papel: 'cta', fala: 'a', acaoVisual: 'b' },
    { papel: 'cta', fala: 'a', acaoVisual: 'b' },
  ],
}), false);

check('rejeita papel inválido', validateUgcScript({
  cena: 'sala',
  avatarDescricao: 'x',
  clipes: [
    { papel: 'introducao', fala: 'a', acaoVisual: 'b' },
    { papel: 'demonstracao', fala: 'a', acaoVisual: 'b' },
  ],
}), false);

check('rejeita fala vazia', validateUgcScript({
  cena: 'sala',
  avatarDescricao: 'x',
  clipes: [
    { papel: 'gancho', fala: '', acaoVisual: 'b' },
    { papel: 'demonstracao', fala: 'a', acaoVisual: 'b' },
  ],
}), false);

check('rejeita sem cena', validateUgcScript({
  cena: '',
  avatarDescricao: 'x',
  clipes: [
    { papel: 'gancho', fala: 'a', acaoVisual: 'b' },
    { papel: 'demonstracao', fala: 'a', acaoVisual: 'b' },
  ],
}), false);

// Prompt do Veo por clipe: aparência E voz do avatar precisam chegar ao modelo,
// senão cada clipe (gerado de forma independente) pode ter uma voz diferente.
const clipPrompt = buildUgcClipPrompt({
  cena: 'quarto iluminado',
  avatarDescricao: 'mulher, 28 anos, tom de voz animado',
  clip: { papel: 'gancho', fala: 'Olha só isso', acaoVisual: 'levanta o fone' },
});
check('prompt do clipe inclui a descrição do avatar (aparência e voz)', clipPrompt.prompt.includes('mulher, 28 anos, tom de voz animado'), true);
check('prompt do clipe inclui a fala', clipPrompt.prompt.includes('Olha só isso'), true);
check('prompt do clipe pede a mesma voz em todos os clipes', clipPrompt.prompt.includes('mesma voz'), true);
check('negativePrompt existe e barra voz robótica', clipPrompt.negativePrompt.includes('voz robótica'), true);

console.log(failures === 0 ? '\nTodas as verificações passaram.' : `\n${failures} verificação(ões) falharam.`);
process.exit(failures === 0 ? 0 : 1);
