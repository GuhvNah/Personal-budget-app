/// <reference types="vitest/config" />
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

/**
 * Emits sw.js with the list of every built file, so the whole app (including
 * the pdf.js worker) is cached on first visit and works offline.
 */
function serviceWorker(): Plugin {
  return {
    name: 'budget-service-worker',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const publicFiles = ['manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'favicon.svg'];
      const precache = ['./', './index.html', ...[...files, ...publicFiles].map((f) => `./${f}`)];
      const version = createHash('sha256').update(precache.join()).digest('hex').slice(0, 12);
      const source = readFileSync(new URL('./src/sw.js', import.meta.url), 'utf8')
        .replace('const VERSION = __VERSION__;', `const VERSION = ${JSON.stringify(version)};`)
        .replace('const PRECACHE = __PRECACHE__;', `const PRECACHE = ${JSON.stringify([...new Set(precache)])};`);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  // Relative base so the app works at any path (GitHub Pages /personal-budget-app/, Netlify root, …).
  base: './',
  plugins: [react(), serviceWorker()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
