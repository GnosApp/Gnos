import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
    // CM6 breaks hard ("Config merge conflict for field override", blank
    // editor) when two module copies of any @codemirror package end up in the
    // graph — facets/fields are identity-based. Force a single copy.
    dedupe: [
      '@codemirror/state',
      '@codemirror/view',
      '@codemirror/language',
      '@codemirror/autocomplete',
      '@codemirror/commands',
      '@codemirror/search',
      '@codemirror/lang-markdown',
      '@lezer/common',
      '@lezer/highlight',
      '@lezer/markdown',
    ],
  },

  server: {
    host: host || false,
    port: 5173,
    strictPort: true,
  },

  envPrefix: ['VITE_', 'TAURI_'],

  optimizeDeps: {
    include: [
      '@excalidraw/excalidraw',
      'roughjs',
      'roughjs/bin/rough',
      'roughjs/bin/generator',
      // Pre-bundle the whole CM6 family together — dynamically-imported entry
      // points otherwise get their own optimizer graphs and duplicate
      // @codemirror/state (identity-based facets → merge-conflict crash).
      '@codemirror/state',
      '@codemirror/view',
      '@codemirror/language',
      '@codemirror/autocomplete',
      '@codemirror/commands',
      '@codemirror/search',
      '@codemirror/lang-markdown',
      // Mermaid is huge and dynamically imported (notebook diagrams). Without
      // pre-bundling, the dev server transforms its dependency tree on first
      // use and the first diagram hangs for a long time.
      'mermaid',
    ],
    esbuildOptions: { target: 'esnext' },
  },

  build: {
    target: 'esnext',
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    commonjsOptions: {
      include: [/node_modules/],
      transformMixedEsModules: true,
    },
    rollupOptions: {
      // `collab` is the PLAN_CONCURRENCY.md §7 web guest client — a second,
      // slim entry point, not a second codebase. It's a plain static page
      // (collab.html), unrelated to the Tauri app's own window (which only
      // ever loads dist/index.html — Tauri's `frontendDist` points at the
      // dist FOLDER, not a specific file, so this extra output is inert for
      // the desktop app and only matters when dist/ is deployed as the web
      // guest client's static host, per PLAN_CONCURRENCY.md §15).
      input: {
        main: path.resolve(__dirname, 'index.html'),
        collab: path.resolve(__dirname, 'collab.html'),
      },
    },
  },
})