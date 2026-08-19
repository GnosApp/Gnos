// Separate build for the PLAN_CONCURRENCY.md §7/§15 web guest client —
// deliberately NOT a variant of vite.config.js's multi-entry output. That
// output is one shared dist/ for the desktop app AND collab.html together,
// which would mean deploying megabytes of unrelated desktop-app chunks
// (Excalidraw, mermaid, pdf.js, algebrite, KaTeX, every view's own code —
// none of it reachable from collab.html, none of it needed by a guest
// joining a note) to whatever serves getgnos.com. This config builds
// collab.html alone, to its own output directory, so what actually deploys
// is exactly what GuestApp.jsx's dependency tree needs: React, yjs,
// y-webrtc, y-codemirror.next, CodeMirror core/markdown/commands, jszip —
// and nothing from the rest of the app.
//
// Usage: `npm run build:collab` → dist-collab/. Point a Cloudflare Pages
// project's build command/output directory at that script and folder.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
    // Same reasoning as vite.config.js: CM6 breaks hard if two module
    // copies of any @codemirror package end up in the graph.
    dedupe: [
      '@codemirror/state',
      '@codemirror/view',
      '@codemirror/commands',
      '@codemirror/lang-markdown',
      '@lezer/common',
      '@lezer/highlight',
      '@lezer/markdown',
    ],
  },

  // NOT the shared public/ (fonts.css's whole self-hosted webfont set,
  // pdfjs, the desktop app's icons) — guest.css already deliberately skips
  // the branded font stack, so shipping those font files here would be
  // pure dead weight. public-collab/ holds only what THIS page needs
  // (today: the Cloudflare Pages _redirects rewrite rule).
  publicDir: path.resolve(__dirname, 'public-collab'),

  build: {
    target: 'esnext',
    outDir: 'dist-collab',
    minify: 'esbuild',
    rollupOptions: {
      input: { collab: path.resolve(__dirname, 'collab.html') },
    },
  },
})
