// Copy pdf.js runtime asset directories into public/pdfjs/.
//
// pdf.js v5 does not inline these — it fetches them at render time from the
// URLs given to getDocument(). With no URL configured, rendering a page that
// uses any of the standard 14 fonts hangs forever rather than erroring, which
// is exactly what happened when this app moved off the CDN build.
//
//   standard_fonts/ — Helvetica, Times, Courier, Symbol, ZapfDingbats
//   cmaps/          — CJK character maps
//   wasm/           — JPEG 2000 / image decoders
//   iccs/           — ICC colour profiles
//
// Runs from predev + prebuild so both the dev server and the packaged app have
// them. public/pdfjs/ is generated — it's gitignored.

import { cp, rm, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const from = join(root, 'node_modules', 'pdfjs-dist')
const to = join(root, 'public', 'pdfjs')

const DIRS = ['standard_fonts', 'cmaps', 'wasm', 'iccs']

await rm(to, { recursive: true, force: true })
await mkdir(to, { recursive: true })
for (const dir of DIRS) {
  await cp(join(from, dir), join(to, dir), { recursive: true })
}
console.log(`[pdfjs] copied ${DIRS.join(', ')} → public/pdfjs/`)
