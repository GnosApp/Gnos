// Bundled pdf.js — single loader shared by the viewer and the importer.
//
// Both used to inject a <script> from cdnjs at runtime. In a packaged Tauri app
// that means PDFs do not open at all offline, and it's third-party script
// execution on every PDF touch. Now the library ships with the app.
//
// Still lazy: pdf.js + its worker are ~1MB, and most sessions never open a PDF,
// so this is a dynamic import rather than a top-level one. Callers await
// loadPdfJs() exactly as they awaited the old script-tag loader.
//
// v5 API notes (the CDN build was 3.11, several breaking changes back):
//   - `renderTextLayer()` is gone — use `new TextLayer({...}).render()`.
//   - the text layer CSS variable is `--total-scale-factor`, not `--scale-factor`.
//   - `page.render({ canvasContext, viewport })` still works as before.

// Runtime assets pdf.js fetches on demand, copied into public/pdfjs/ by
// scripts/copy-pdfjs-assets.mjs. These are NOT optional: v5 stopped inlining
// the standard-14 font data, and a page that uses Helvetica/Times/Courier
// hangs in render() — no error, just a promise that never settles — when
// standardFontDataUrl is unset. cmaps matter for CJK, wasm for JPEG 2000.
const PDFJS_ASSETS = '/pdfjs/'

export const PDF_ASSET_OPTIONS = {
  standardFontDataUrl: `${PDFJS_ASSETS}standard_fonts/`,
  cMapUrl: `${PDFJS_ASSETS}cmaps/`,
  cMapPacked: true,
  wasmUrl: `${PDFJS_ASSETS}wasm/`,
  iccUrl: `${PDFJS_ASSETS}iccs/`,
}

// Open a document with the asset URLs applied. Prefer this over calling
// getDocument() directly so no call site can forget them.
export async function openPdf(source) {
  const lib = await loadPdfJs()
  return lib.getDocument({ ...PDF_ASSET_OPTIONS, ...source }).promise
}

let _pdfjs = null

export function loadPdfJs() {
  if (!_pdfjs) {
    _pdfjs = (async () => {
      const [lib, worker] = await Promise.all([
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
        // Real text-layer styles. These set the text spans to `color:
        // transparent`, which is how selectable-but-invisible text is supposed
        // to work — the old code faked it with `opacity: 0.2` on the whole
        // layer, leaving ghost text visible on top of the page raster.
        import('pdfjs-dist/web/pdf_viewer.css'),
      ])
      lib.GlobalWorkerOptions.workerSrc = worker.default
      return lib
    })()
  }
  return _pdfjs
}
