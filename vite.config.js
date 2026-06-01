import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
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
