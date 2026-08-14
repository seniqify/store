import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

// A unique id per build. Baked into the app (as __APP_VERSION__) AND written to
// dist/version.json, so an open tab can detect when a newer build is deployed
// and reload to it — see src/utils/versionGuard.js.
const BUILD_ID = String(Date.now());

function versionFile() {
  return {
    name: 'write-version-json',
    apply: 'build',
    closeBundle() {
      try {
        const dir = resolve(process.cwd(), 'dist');
        mkdirSync(dir, { recursive: true });
        writeFileSync(resolve(dir, 'version.json'), JSON.stringify({ v: BUILD_ID }));
      } catch { /* non-fatal */ }
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(BUILD_ID),
  },
  plugins: [
    react(),
    tailwindcss(),
    versionFile(),
  ],
  build: {
    rollupOptions: {
      output: {
        // Split rarely-changing vendor code into its own long-cached chunk so
        // app updates don't re-download React, and so the entry stays lean.
        // (Rolldown requires manualChunks as a function, not an object.)
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (/[\\/]react(-dom|-router-dom)?[\\/]/.test(id)) return 'react-vendor';
            if (id.includes('@supabase')) return 'supabase';
          }
        },
      },
    },
  },
})
