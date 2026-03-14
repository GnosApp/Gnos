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
  },
})