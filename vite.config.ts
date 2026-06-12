import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {execFileSync} from 'child_process';
import {defineConfig} from 'vite';

function getBuildVersion(): string {
  let commit = 'dev';
  try {
    commit = execFileSync('git', ['rev-parse', '--short', 'HEAD']).toString().trim();
  } catch {
    // git not available — fall back to "dev"
  }
  // Build date in UTC, format YYYY-MM-DD HH:mm
  const date = new Date().toISOString().slice(0, 16).replace('T', ' ');
  return `${commit} · ${date} UTC`;
}

export default defineConfig(() => {
  return {
    define: {
      __BUILD_VERSION__: JSON.stringify(getBuildVersion()),
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
