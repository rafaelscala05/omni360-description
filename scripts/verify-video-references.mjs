// Verificação da montagem das referências de vídeo (fotos escolhidas, painel
// do Veo, clipe único do Seedance, regras de ângulo). Lógica pura + sharp:
// não sobe servidor, não chama Veo/Seedance nem o Storage.
// Rodar com: npx tsx scripts/verify-video-references.mjs
import sharp from 'sharp';
import {
  sanitizePhotoUrls, buildPhotoPanel, MAX_PRODUCT_PHOTOS, VEO_MAX_REFERENCE_IMAGES,
  CAMERA_VARIETY_RULE, PRODUCT_COVERAGE_RULE,
} from '../server/videoShared.ts';
import { SEEDANCE_MAX_REFERENCE_IMAGES, SEEDANCE_MAX_DURATION_SECONDS } from '../server/videoProviders.ts';
import {
  buildClassicSeedanceReferences, buildClassicSeedancePrompt, buildClassicShotPrompt, buildClassicNegativePrompt,
} from '../server/videoAgent.ts';
import { buildUgcSeedancePrompt, buildUgcSeedanceReferences, buildUgcClipPrompt, buildUgcScriptPrompt } from '../server/ugcVideoAgent.ts';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  ok' : 'FALHA'}  ${label}${ok ? '' : ` → esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`}`);
}

const img = (name) => ({ url: `https://storage.exemplo/${name}.jpg`, base64: 'AAAA', mimeType: 'image/jpeg' });

// --- sanitizePhotoUrls ---
check('sanitizePhotoUrls: não-array vira []', sanitizePhotoUrls(undefined), []);
check('sanitizePhotoUrls: descarta vazios/não-string e repetidos, mantém a ordem',
  sanitizePhotoUrls(['a', '', ' a ', 3, null, 'b']), ['a', 'b']);
check(`sanitizePhotoUrls: corta em ${MAX_PRODUCT_PHOTOS}`,
  sanitizePhotoUrls(Array.from({ length: 12 }, (_, i) => `u${i}`)).length, MAX_PRODUCT_PHOTOS);

// --- buildPhotoPanel ---
async function solid(color) {
  const buf = await sharp({ create: { width: 800, height: 600, channels: 3, background: color } }).jpeg().toBuffer();
  return { url: color, base64: buf.toString('base64'), mimeType: 'image/jpeg' };
}
const [red, green, blue] = await Promise.all(['#ff0000', '#00ff00', '#0000ff'].map(solid));
const single = await buildPhotoPanel([red]);
check('buildPhotoPanel com 1 foto devolve a própria foto', single.base64, red.base64);
const panel = await buildPhotoPanel([red, green, blue]);
const meta = await sharp(Buffer.from(panel.base64, 'base64')).metadata();
check('buildPhotoPanel com 3 fotos gera um JPEG', [panel.mimeType, meta.format], ['image/jpeg', 'jpeg']);
check('buildPhotoPanel respeita o tamanho de referência (≤ 1024px)', Math.max(meta.width, meta.height) <= 1024, true);
let emptyThrew = false;
try { await buildPhotoPanel([]); } catch { emptyThrew = true; }
check('buildPhotoPanel sem fotos lança', emptyThrew, true);

// --- Regras de ângulo/cobertura ---
check('CAMERA_VARIETY_RULE amarra os ângulos às fotos reais', CAMERA_VARIETY_RULE.includes('FOTOS REAIS'), true);
check('CAMERA_VARIETY_RULE não sugere mais órbita ao redor do produto', /órbita ao redor/.test(CAMERA_VARIETY_RULE), false);
check('PRODUCT_COVERAGE_RULE proíbe abrir/desmontar sem foto', /abrir/.test(PRODUCT_COVERAGE_RULE) && /desmontar/.test(PRODUCT_COVERAGE_RULE), true);
const ugcScriptPrompt = buildUgcScriptPrompt({ description: 'd', brand: '', productName: 'p', category: '', attributes: {}, avatarDescricao: 'a' });
check('roteiro UGC inclui a regra de cobertura', ugcScriptPrompt.includes(PRODUCT_COVERAGE_RULE), true);
check('roteiro UGC explica a ordem das imagens anexadas', ugcScriptPrompt.includes('a PRIMEIRA é o avatar'), true);

// --- Clássico: Veo (um prompt por shot) ---
const script = {
  cena: 'bancada de cozinha',
  trilha: 'leve',
  inicio: { acao: 'Câmera: close frontal. ação 1', narracao: 'n1' },
  meioDemonstracao: { acao: 'Câmera: plano médio. ação 2', narracao: 'n2' },
  meioBeneficios: { acao: 'Câmera: detalhe. ação 3', narracao: 'n3' },
  fim: { acao: 'Câmera: plano aberto. ação 4', narracao: 'n4' },
};
const shotPrompt = buildClassicShotPrompt(script, 1, { hasSheet: true, hasPhotoPanel: true });
check('prompt do shot Veo traz a ação do próprio shot', shotPrompt.includes('ação 2') && !shotPrompt.includes('ação 1'), true);
check('prompt do shot Veo traz o limite do produto e a linha do painel', /LIMITE DO PRODUTO/.test(shotPrompt) && /FOTOS REAIS/.test(shotPrompt), true);
check('negativo do Veo inclui painel e partes não fotografadas',
  /painel de fotos/.test(buildClassicNegativePrompt({ hasSheet: true, hasPhotoPanel: true })) && /verso inventado/.test(buildClassicNegativePrompt({ hasSheet: true, hasPhotoPanel: true })), true);
// Veo: cena + folha + painel = teto de 3 referências.
check('Veo clássico cabe no teto de referências (cena + folha + painel)', 3 <= VEO_MAX_REFERENCE_IMAGES, true);

// --- Clássico: Seedance (clipe único) ---
const seedancePrompt = buildClassicSeedancePrompt(script, SEEDANCE_MAX_DURATION_SECONDS, { hasSheet: true });
check('prompt Seedance clássico é um vídeo único de 30s', seedancePrompt.includes('Vídeo ÚNICO e contínuo de 30s'), true);
check('prompt Seedance clássico tem a linha do tempo dos 4 atos (7.5s cada)',
  ['[0s–7.5s]', '[7.5s–15s]', '[15s–22.5s]', '[22.5s–30s]'].every((t) => seedancePrompt.includes(t)), true);
check('prompt Seedance clássico traz as 4 ações', ['ação 1', 'ação 2', 'ação 3', 'ação 4'].every((a) => seedancePrompt.includes(a)), true);

const sceneA = img('cena-a');
const sceneB = img('cena-b');
const photos = Array.from({ length: 8 }, (_, i) => img(`foto-${i + 1}`));
const sheet = img('folha');
const classicRefs = buildClassicSeedanceReferences([sceneA, sceneB, photos[0], sceneA], photos, sheet, SEEDANCE_MAX_REFERENCE_IMAGES);
check(`Seedance clássico respeita o teto de ${SEEDANCE_MAX_REFERENCE_IMAGES} imagens`, classicRefs.length, SEEDANCE_MAX_REFERENCE_IMAGES);
check('Seedance clássico: cena repetida vira uma referência só, rotulada com os atos',
  classicRefs.filter((r) => r.url === sceneA.url).map((r) => r.papel.includes('atos 1 e 4')), [true]);
check('Seedance clássico: foto que também é cena não vai duplicada',
  classicRefs.filter((r) => r.url === photos[0].url).length, 1);
check('Seedance clássico: folha vai por último', classicRefs.at(-1).url, sheet.url);
check('Seedance clássico: toda referência tem URL (o Seedance lê por URL)', classicRefs.every((r) => !!r.url), true);

// --- UGC: Veo e Seedance ---
const ugcScript = {
  cena: 'quarto',
  avatarDescricao: 'mulher, 28 anos',
  clipes: [
    { papel: 'gancho', fala: 'fala um', acaoVisual: 'acao um' },
    { papel: 'demonstracao', fala: 'fala dois', acaoVisual: 'acao dois' },
    { papel: 'cta', fala: 'fala tres', acaoVisual: 'acao tres' },
  ],
};
const ugcClip = buildUgcClipPrompt({ cena: 'q', avatarDescricao: 'a', clip: ugcScript.clipes[0], hasProductReference: true, hasPhotoPanel: true });
check('clipe UGC Veo traz o limite do produto e o painel', /LIMITE DO PRODUTO/.test(ugcClip.prompt) && /FOTOS REAIS/.test(ugcClip.prompt), true);

const ugcSeedance = buildUgcSeedancePrompt(ugcScript, { hasProductReference: true });
check('UGC Seedance: 3 clipes viram um clipe de 24s', ugcSeedance.durationSeconds, 24);
check(`UGC Seedance cabe nos ${SEEDANCE_MAX_DURATION_SECONDS}s do modelo`, ugcSeedance.durationSeconds <= SEEDANCE_MAX_DURATION_SECONDS, true);
check('UGC Seedance: linha do tempo com todas as falas',
  ['[0s–8s]', '[8s–16s]', '[16s–24s]', 'fala um', 'fala dois', 'fala tres'].every((t) => ugcSeedance.prompt.includes(t)), true);
check('UGC Seedance: pede a mesma voz no vídeo inteiro', ugcSeedance.prompt.includes('MESMA voz'), true);

const ugcSeedanceComAparencia = buildUgcSeedancePrompt(ugcScript, { hasProductReference: true, aparenciaAvatar: 'cabelo castanho curto, camiseta azul' });
check('UGC Seedance: avatar vai só por texto (sem @Image de pessoa)', /não há imagem de referência da pessoa/.test(ugcSeedance.prompt), true);
check('UGC Seedance: leva a descrição salva do avatar', ugcSeedance.prompt.includes('mulher, 28 anos'), true);
check('UGC Seedance: leva a aparência lida do retrato quando existe', ugcSeedanceComAparencia.prompt.includes('Aparência: cabelo castanho curto, camiseta azul'), true);
check('UGC Seedance: sem aparência, não gera linha vazia', /Aparência:/.test(ugcSeedance.prompt), false);

const ugcRefs = buildUgcSeedanceReferences(photos, sheet, SEEDANCE_MAX_REFERENCE_IMAGES);
check('UGC Seedance: nenhuma referência é o avatar (filtro de rosto do Seedance)', ugcRefs.some((r) => /AVATAR/.test(r.papel)), false);
check('UGC Seedance: folha vai por último', ugcRefs.at(-1).url, sheet.url);
check(`UGC Seedance: fotos ocupam o teto menos a folha (${SEEDANCE_MAX_REFERENCE_IMAGES - 1})`,
  ugcRefs.filter((r) => r.papel.startsWith('FOTO REAL')).length, Math.min(photos.length, SEEDANCE_MAX_REFERENCE_IMAGES - 1));
check('UGC Seedance: com 2 fotos manda as 2 + folha', buildUgcSeedanceReferences(photos.slice(0, 2), sheet, 9).length, 3);

console.log(failures === 0 ? '\nTodas as verificações passaram.' : `\n${failures} verificação(ões) falharam.`);
process.exit(failures === 0 ? 0 : 1);
