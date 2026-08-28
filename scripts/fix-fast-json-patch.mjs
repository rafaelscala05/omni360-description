// fast-json-patch@3.1.1 (pulled in transitively by @ag-ui/client, a dependency
// of the CopilotKit packages) ships a stray `index.ts` next to its real
// `index.js` entry point. Under `tsx` (used by `npm run dev`), that stray file
// gets picked up instead of the compiled `index.js`, and its own internal
// `require('./src/core')` doesn't exist in the published package, crashing the
// dev server with MODULE_NOT_FOUND. `npm run build` is unaffected (esbuild
// resolves `package.json#main` correctly and never touches this file) — this
// is a `tsx`/dev-server-only issue.
//
// Renaming the file out of the way is harmless: nothing imports
// `fast-json-patch/index.ts` directly, only the bare `fast-json-patch`
// specifier, which correctly resolves to `index.js` once `index.ts` isn't
// there to shadow it.
import { existsSync, renameSync } from 'node:fs';

const path = 'node_modules/fast-json-patch/index.ts';
if (existsSync(path)) {
  renameSync(path, `${path}.bak`);
  console.log(`[fix-fast-json-patch] renamed ${path} -> ${path}.bak`);
}
