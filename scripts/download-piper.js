#!/usr/bin/env node
/**
 * Downloads the Piper TTS binary + bundled voices into src-tauri/piper/
 * Runs before `tauri build` so the files get bundled as resources.
 * Idempotent — skips files that already exist.
 * Requires: Node 18+, system `tar` (macOS/Linux built-in), `unzip` on Windows.
 */

import https from 'https'
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'

const __dirname  = path.dirname(fileURLToPath(import.meta.url))
const ROOT       = path.resolve(__dirname, '..')
const PIPER_DIR  = path.join(ROOT, 'src-tauri', 'piper')
const MODELS_DIR = path.join(PIPER_DIR, 'models')

fs.mkdirSync(MODELS_DIR, { recursive: true })

// ── Config ────────────────────────────────────────────────────────────────────

const PIPER_VERSION = '2023.11.14-2'
const PIPER_BASE    = `https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}`

const PLATFORM_MAP = {
  'darwin-arm64': { archive: 'piper_macos_aarch64.tar.gz' },
  'darwin-x64':   { archive: 'piper_macos_x64.tar.gz'     },
  'linux-x64':    { archive: 'piper_linux_x86_64.tar.gz'  },
  'linux-arm64':  { archive: 'piper_linux_aarch64.tar.gz' },
  'win32-x64':    { archive: 'piper_windows_amd64.zip'    },
}

// Voices bundled in the app — .onnx (~60 MB each) + .onnx.json (tiny config)
const VOICES = [
  { name: 'en_US-amy-medium',  hfPath: 'en/en_US/amy/medium/en_US-amy-medium'  },
  { name: 'en_US-ryan-medium', hfPath: 'en/en_US/ryan/medium/en_US-ryan-medium' },
]

const HF_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main'

// ── Helpers ───────────────────────────────────────────────────────────────────

function download(url, dest) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(dest)) {
      console.log(`  skip (exists): ${path.basename(dest)}`)
      return resolve()
    }
    console.log(`  downloading:   ${path.basename(dest)}`)
    const tmp  = dest + '.tmp'
    const file = fs.createWriteStream(tmp)

    function get(u) {
      https.get(u, { headers: { 'User-Agent': 'gnos-build/1.0' } }, res => {
        if (res.statusCode === 301 || res.statusCode === 302) return get(res.headers.location)
        if (res.statusCode !== 200) {
          file.close(); if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
          return reject(new Error(`HTTP ${res.statusCode} — ${u}`))
        }
        const total = parseInt(res.headers['content-length'] || '0', 10)
        let received = 0
        res.on('data', chunk => {
          received += chunk.length
          if (total) process.stdout.write(`\r  ${path.basename(dest)}: ${Math.round(received / total * 100)}%   `)
        })
        res.pipe(file)
        file.on('finish', () => {
          file.close()
          process.stdout.write('\n')
          fs.renameSync(tmp, dest)
          resolve()
        })
      }).on('error', err => {
        file.close(); if (fs.existsSync(tmp)) fs.unlinkSync(tmp); reject(err)
      })
    }
    get(url)
  })
}

// ── Binary ────────────────────────────────────────────────────────────────────

const platform    = `${process.platform}-${process.arch}`
const platformCfg = PLATFORM_MAP[platform]

if (!platformCfg) {
  console.warn(`[piper] No binary available for ${platform} — skip`)
} else {
  const binName    = process.platform === 'win32' ? 'piper.exe' : 'piper'
  const binDest    = path.join(PIPER_DIR, binName)
  const archivePath = path.join(PIPER_DIR, platformCfg.archive)

  console.log(`\n[piper] Binary for ${platform}`)
  await download(`${PIPER_BASE}/${platformCfg.archive}`, archivePath)

  if (!fs.existsSync(binDest)) {
    console.log(`  extracting…`)
    if (archivePath.endsWith('.tar.gz')) {
      // Extract just the `piper` binary from the archive (it's in a piper/ subfolder)
      execSync(`tar -xzf "${archivePath}" -C "${PIPER_DIR}" --strip-components=1 piper/piper`, { stdio: 'inherit' })
    } else {
      execSync(`unzip -o "${archivePath}" "piper/piper.exe" -d "${PIPER_DIR}"`, { stdio: 'inherit' })
      const inner = path.join(PIPER_DIR, 'piper', 'piper.exe')
      if (fs.existsSync(inner)) { fs.renameSync(inner, binDest); fs.rmdirSync(path.join(PIPER_DIR, 'piper')) }
    }
  }

  if (process.platform !== 'win32' && fs.existsSync(binDest)) {
    fs.chmodSync(binDest, 0o755)
    console.log(`  chmod +x piper`)
  }

  // Clean up archive (large, not needed after extraction)
  if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath)
}

// ── Voices ────────────────────────────────────────────────────────────────────

console.log(`\n[piper] Voices`)
for (const voice of VOICES) {
  await download(`${HF_BASE}/${voice.hfPath}.onnx`,      path.join(MODELS_DIR, `${voice.name}.onnx`))
  await download(`${HF_BASE}/${voice.hfPath}.onnx.json`, path.join(MODELS_DIR, `${voice.name}.onnx.json`))
}

console.log('\n[piper] Done.\n')
