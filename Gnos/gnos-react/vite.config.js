import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

// ESM-compatible __dirname replacement
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },

  // ── Excalidraw fix ────────────────────────────────────────────────────────
  // Excalidraw bundles CJS deps that Vite's pre-bundler can't handle without
  // explicit opt-in. Force them through esbuild pre-bundling.
  optimizeDeps: {
    include: [
      '@excalidraw/excalidraw',
      'roughjs',
      'roughjs/bin/rough',
      'roughjs/bin/generator',
    ],
    esbuildOptions: {
      target: 'esnext',
    },
  },

  build: {
    target: 'esnext',
    commonjsOptions: {
      include: [/node_modules/],
      transformMixedEsModules: true,
    },
  },
})