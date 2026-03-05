// ============================================================================
// STORAGE POLYFILL & CONSTANTS
// ============================================================================
const DB_NAME = "BiblioDB";
const STORE_NAME = "keyval";

const initDB = () => new Promise((resolve, reject) => {
  const req = indexedDB.open(DB_NAME, 1);
  req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

window.storage = window.storage || {
  _db: null,
  async getDB() {
    if (!this._db) this._db = await initDB();
    return this._db;
  },
  async get(k) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(k);
      req.onsuccess = () => resolve(req.result !== undefined ? { value: req.result } : null);
      req.onerror = () => reject(req.error);
    });
  },
  async set(k, v) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const req = tx.objectStore(STORE_NAME).put(v, k);
      req.onsuccess = () => resolve({ value: v });
      req.onerror = () => reject(req.error);
    });
  },
  async delete(k) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const req = tx.objectStore(STORE_NAME).delete(k);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
};

const CHUNK_SIZE = 100;
const MAX_SINGLE_KB = 4_500_000;
const BLOCK_OPEN = new Set(["p","div","li","tr","blockquote","section","article","figure","header","footer","main","td","th"]);
const BLOCK_CLOSE = new Set(["p","div","li","tr","blockquote","section","article","figure","header","footer","main","td","th"]);
const CHAPTER_RE = /^(chapter\s+[\divxlcdm]+.*|part\s+[\divxlcdm]+.*|\bprologue\b.*|\bepilogue\b.*|\bintroduction\b.*|\bpreface\b.*)$/i;

const BUILT_IN_THEMES = {
  dark: {
    name: "Dark",
    bg: "#0d1117", surface: "#161b22", surfaceAlt: "#21262d", border: "#30363d", borderSubtle: "#21262d",
    text: "#e6edf3", textMuted: "#8b949e", textDim: "#6e7681", textDisabled: "#3d444d",
    accent: "#388bfd", accentSecondary: "#a371f7", readerBg: "#111820", readerCard: "#161b22", readerText: "#cdd9e5",
    headerBg: "#0d1117", progressTrack: "#21262d", buttonBorder: "#30363d", addBookBorder: "#30363d",
    addBookBg: "rgba(56,139,253,0.04)", addBookHover: "rgba(56,139,253,0.09)", addBookIcon: "#388bfd", addBookText: "#8b949e", tagBg: "#21262d"
  },
  light: {
    name: "Light (Cream)",
    bg: "#f5f0e8", surface: "#fdfaf4", surfaceAlt: "#ede8dc", border: "#d5cfc3", borderSubtle: "#e8e2d6",
    text: "#2c2416", textMuted: "#7a6e5e", textDim: "#9a8e7e", textDisabled: "#c5bfb3",
    accent: "#7c6034", accentSecondary: "#a0522d", readerBg: "#f0ebe0", readerCard: "#fdfaf4", readerText: "#3a2e1e",
    headerBg: "#fdfaf4", progressTrack: "#ddd7cb", buttonBorder: "#c8c2b6", addBookBorder: "#c8c2b6",
    addBookBg: "rgba(124,96,52,0.04)", addBookHover: "rgba(124,96,52,0.09)", addBookIcon: "#7c6034", addBookText: "#7a6e5e", tagBg: "#ede8dc"
  }
};

// ============================================================================
// STATE
// ============================================================================
const state = {
  view: "library",
  library: [],
  activeBook: null,
  pages: [],
  currentPage: 0,
  themeKey: "dark",
  customThemes: {},
  tapToTurn: true,
  twoPage: false,
  fontSize: 18,
  lineSpacing: 1.8,
  fontFamily: "Georgia, serif",
  audioSrc: null,
  isPlaying: false,
  searchQuery: "",
  activeLibTab: "books",
  connectedFolder: null,
  // Accessibility
  highlightWords: false,
  underlineLine: false,
  // AI settings
  ollamaUrl: "",
  ollamaModel: "",
  // Reading tracking: { "YYYY-MM-DD": minutes }
  readingLog: {},
  // Session tracking
  sessionStart: null,
  sessionBookId: null,
  // Notes: { bookId: [{id, quote, text, page, createdAt}] }
  notes: {},
};

// ============================================================================
// UTILITIES & PARSING
// ============================================================================
const readFileAsText = (file) => new Promise((res, rej) => {
  const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(file);
});
const readFileAsDataURL = (file) => new Promise((res, rej) => {
  const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file);
});

function decodeEntities(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#160;|&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}

function resolveHref(baseDir, href) {
  const noFrag = decodeURIComponent(href).split("#")[0];
  if (!noFrag) return null;
  if (noFrag.startsWith("/")) return noFrag.slice(1);
  const parts = (baseDir + noFrag).split("/");
  const out = [];
  for (const p of parts) { if (p === "..") out.pop(); else if (p && p !== ".") out.push(p); }
  return out.join("/");
}

function getAttr(tag, name) {
  const m = tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return m ? (m[1] ?? m[2] ?? null) : null;
}

function zipFind(zip, path) {
  if (!path) return null;
  const f = zip.file(path); if (f) return f;
  const lo = path.toLowerCase();
  const k = Object.keys(zip.files).find((x) => x.toLowerCase() === lo);
  return k ? zip.file(k) : null;
}

function generateCoverColor(title) {
  const pairs = [
    ["#2C3E50","#3498DB"],["#1A1A2E","#E94560"],["#0F3460","#533483"],["#16213E","#0F3460"],
    ["#1B262C","#0F4C75"],["#2C2C54","#706FD3"],["#1C1C1C","#636E72"],["#2D3436","#6C5CE7"],
    ["#1E3799","#4A69BD"],["#192a56","#218c74"],["#4a1942","#c0392b"],["#1a3c34","#27ae60"],
  ];
  let h = 0;
  for (let i=0; i<title.length; i++) h = (h * 31 + title.charCodeAt(i)) & 0xffffffff;
  return pairs[Math.abs(h) % pairs.length];
}

function countWords(str) {
  let n = 0, inW = false;
  for (let i = 0; i < str.length; i++) {
    const ws = str.charCodeAt(i) <= 32;
    if (!ws && !inW) { n++; inW = true; } else if (ws) inW = false;
  }
  return n;
}

// ============================================================================
// PIXEL-ACCURATE PAGE LAYOUT (like Apple Books / Kindle)
// ============================================================================
let _measureEl = null;

function ensureMeasureEl() {
  if (_measureEl && document.body.contains(_measureEl)) return _measureEl;
  _measureEl = document.createElement("div");
  _measureEl.setAttribute("aria-hidden", "true");
  _measureEl.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;top:-9999px;left:0;z-index:-1;overflow:hidden;";
  document.body.appendChild(_measureEl);
  return _measureEl;
}

function getPageDimensions() {
  const cardPadH = 88, cardPadW = 112, headerH = 52, footerH = 64, outerPadH = 28, outerPadW = 48;
  const maxCardW = state.twoPage ? 1280 : 680;
  const viewW = window.innerWidth || 1024;
  const viewH = window.innerHeight || 768;
  const cardW = Math.min(viewW - outerPadW, maxCardW);
  const colW = state.twoPage ? cardW / 2 - cardPadW - 40 : cardW - cardPadW;
  const pageH = viewH - headerH - footerH - outerPadH - cardPadH;
  return { colW: Math.max(180, colW), pageH: Math.max(180, pageH) };
}

function measureBlockH(text, type) {
  const mel = ensureMeasureEl();
  const { colW } = getPageDimensions();
  mel.style.width = `${colW}px`;
  mel.style.fontFamily = state.fontFamily;
  const el = document.createElement("p");
  if (type === "heading") {
    el.style.cssText = `margin:0;font-size:${Math.round(state.fontSize*1.4)}px;font-weight:700;line-height:1.25;word-break:break-word;`;
  } else if (type === "subheading") {
    el.style.cssText = `margin:0;font-size:${Math.round(state.fontSize*1.15)}px;font-weight:600;line-height:1.35;word-break:break-word;`;
  } else {
    el.style.cssText = `margin:0;font-size:${state.fontSize}px;line-height:${state.lineSpacing};text-align:justify;word-break:break-word;hyphens:auto;`;
  }
  el.textContent = text;
  mel.innerHTML = "";
  mel.appendChild(el);
  const h = el.getBoundingClientRect().height;
  return h > 0 ? Math.ceil(h) : null; // return null if measurement failed
}

// Estimate words per page using simple geometry (used as fallback)
function estimateWordsPerPage() {
  const { colW, pageH } = getPageDimensions();
  const charW = state.fontSize * 0.52;
  const lineH = state.fontSize * state.lineSpacing;
  const charsPerLine = Math.max(1, Math.floor(colW / charW));
  const linesPerPage = Math.max(1, Math.floor(pageH / lineH));
  return Math.max(80, Math.floor((charsPerLine / 5.5) * linesPerPage * 0.88));
}

function splitBlocksIntoPages(blocks) {
  // Try pixel-accurate layout first; fall back to word-count if measurements fail
  const { pageH } = getPageDimensions();
  const safeH = Math.floor(pageH * 0.97);
  const PARA_GAP = Math.round(state.fontSize * 0.45);
  const minLineH = Math.ceil(state.fontSize * state.lineSpacing);

  // Quick measurement test to see if DOM measurement is available
  const testH = measureBlockH("test word", "para");
  const canMeasure = testH !== null && testH > 0;

  if (!canMeasure) {
    // Fallback: word-count based splitting
    const wpp = estimateWordsPerPage();
    const pages = []; let cur = [], curWords = 0, isChap = false;
    const flush = () => { if (cur.length) { pages.push(cur); cur = []; curWords = 0; isChap = false; } };
    for (const block of blocks) {
      if (block.type === "heading") { flush(); cur.push(block); isChap = true; continue; }
      if (block.type === "subheading") { if (isChap && curWords === 0) cur.push(block); else { flush(); cur.push(block); isChap = true; } continue; }
      if (isChap) flush();
      const words = block.text.split(/\s+/).filter(Boolean);
      let wi = 0;
      while (wi < words.length) {
        const take = Math.min(wpp - curWords, words.length - wi);
        if (take <= 0) { flush(); continue; }
        cur.push({ type: "para", text: words.slice(wi, wi + take).join(" ") });
        curWords += take; wi += take;
        if (curWords >= wpp) flush();
      }
    }
    flush();
    return pages.length > 0 ? pages : [[{ type: "para", text: "" }]];
  }

  // Pixel-accurate splitting via DOM measurement
  const pages = [];
  let cur = [], curH = 0, isChapterPage = false;

  const flush = () => {
    if (cur.length > 0) { pages.push(cur); cur = []; curH = 0; isChapterPage = false; }
  };

  for (const block of blocks) {
    if (block.type === "heading") {
      flush(); cur.push(block); isChapterPage = true; continue;
    }
    if (block.type === "subheading") {
      if (isChapterPage && curH === 0) { cur.push(block); }
      else { flush(); cur.push(block); isChapterPage = true; }
      continue;
    }
    if (isChapterPage) flush();

    const words = block.text.split(/\s+/).filter(Boolean);
    let wi = 0;
    let safetyLimit = words.length * 3; // prevent any possible infinite loop

    while (wi < words.length && safetyLimit-- > 0) {
      const gap = cur.length > 0 ? PARA_GAP : 0;
      const available = safeH - curH - gap;

      if (available < minLineH) {
        if (cur.length > 0) { flush(); continue; }
        // Even on empty page there's no space — just push one word and move on
        cur.push({ type: "para", text: words[wi] });
        curH += minLineH;
        wi++;
        flush();
        continue;
      }

      // Binary search for max words fitting in available height
      let lo = 1, hi = words.length - wi, best = 0;
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const h = measureBlockH(words.slice(wi, wi + mid).join(" "), "para") ?? (mid * minLineH / 5);
        if (h <= available) { best = mid; lo = mid + 1; }
        else { hi = mid - 1; }
      }

      if (best === 0) {
        if (cur.length > 0) { flush(); continue; }
        best = 1; // force at least 1 word
      }

      const chunk = words.slice(wi, wi + best).join(" ");
      const chunkH = measureBlockH(chunk, "para") ?? minLineH;
      cur.push({ type: "para", text: chunk });
      curH += gap + chunkH;
      wi += best;

      if (safeH - curH < minLineH && wi < words.length) flush();
    }
  }
  flush();
  return pages.length > 0 ? pages : [[{ type: "para", text: "" }]];
}

function htmlToBlocks(html) {
  let h = html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<link[^>]*>/g, " ");
  const blocks = []; let pos = 0, textBuf = "";

  const flush = () => {
    const t = decodeEntities(textBuf.replace(/[ \t\r\n]+/g, " ").trim());
    if (t.length > 1) blocks.push({ type: "para", text: t });
    textBuf = "";
  };

  while (pos < h.length) {
    const lt = h.indexOf("<", pos);
    if (lt === -1) { textBuf += h.slice(pos); break; }
    textBuf += h.slice(pos, lt);
    const gt = h.indexOf(">", lt);
    if (gt === -1) { textBuf += h.slice(lt); break; }
    const tag = h.slice(lt, gt + 1);
    pos = gt + 1;

    const inner = tag.slice(1, -1).trim();
    const isClose = inner.startsWith("/");
    const name = inner.replace(/^\//, "").split(/[\s/]/)[0].toLowerCase();

    if (/^h[1-6]$/.test(name) && !isClose) {
      flush();
      const closeStr = `</${name}`; const closeIdx = h.toLowerCase().indexOf(closeStr, pos);
      const headContent = closeIdx === -1 ? h.slice(pos) : h.slice(pos, closeIdx);
      const text = decodeEntities(headContent.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
      if (text) blocks.push({ type: parseInt(name[1]) === 1 ? "heading" : "subheading", text });
      if (closeIdx !== -1) { const afterGt = h.indexOf(">", closeIdx); pos = afterGt !== -1 ? afterGt + 1 : closeIdx + closeStr.length; }
      continue;
    }
    if (BLOCK_OPEN.has(name) || BLOCK_CLOSE.has(name)) { flush(); continue; }
    if (name === "br") { textBuf += " "; continue; }
  }
  flush(); return blocks;
}


function deriveChaptersFromPages(pages) {
  const chapters = [];
  for (let i = 0; i < pages.length; i++) {
    const pg = pages[i];
    if (!Array.isArray(pg) || pg.length === 0) continue;
    if (pg.every((b) => b.type === "heading" || b.type === "subheading")) {
      const h = pg.find((b) => b.type === "heading"), s = pg.find((b) => b.type === "subheading");
      chapters.push({ title: h?.text || s?.text || `Section ${chapters.length + 1}`, pageIndex: i });
    }
  }
  if (chapters.length === 0) chapters.push({ title: "Beginning", pageIndex: 0 });
  return chapters;
}

function textToBlocks(text) {
  const blocks = [], lines = text.split("\n"); let i = 0;
  while (i < lines.length) {
    const raw = lines[i], trimmed = raw.trim();
    if (!trimmed) { i++; continue; }
    const prevBlank = i === 0 || !lines[i - 1]?.trim(), nextBlank = i >= lines.length - 1 || !lines[i + 1]?.trim();
    const isChapter = CHAPTER_RE.test(trimmed) && trimmed.length < 100;
    const isAllCaps = trimmed === trimmed.toUpperCase() && /[A-Z]{2}/.test(trimmed) && trimmed.length < 80;
    const isStandalone = prevBlank && nextBlank && trimmed.length < 65;

    if (isChapter || (isAllCaps && prevBlank && nextBlank) || (isStandalone && /^[A-Z\d]/.test(trimmed))) { blocks.push({ type: "heading", text: trimmed }); i++; continue; }
    const paraLines = []; while (i < lines.length && lines[i].trim()) { paraLines.push(lines[i].trim()); i++; }
    if (paraLines.length) blocks.push({ type: "para", text: paraLines.join(" ") });
  }
  return blocks;
}

async function loadJSZip() {
  if (window.JSZip) return window.JSZip;
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
    s.onload = () => resolve(window.JSZip); s.onerror = reject; document.head.appendChild(s);
  });
}

async function parseEpub(file) {
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const containerXml = await zipFind(zip, "META-INF/container.xml")?.async("string");
  if (!containerXml) throw new Error("Invalid EPUB");
  const opfMatch = containerXml.match(/full-path\s*=\s*["']([^"']+)["']/i);
  const opfPath = opfMatch[1].replace(/^\//, "");
  const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
  const opfXml = await zipFind(zip, opfPath)?.async("string");

  const titleM = opfXml.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i);
  const authorM = opfXml.match(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i);
  const epubTitle = titleM ? decodeEntities(titleM[1].trim()) : file.name.replace(/\.epub3?$/i, "");
  const epubAuthor = authorM ? decodeEntities(authorM[1].trim()) : "";

  const manifest = {};
  let m, itemRe = /<item\s([^>]+?)\/?>/gi;
  while ((m = itemRe.exec(opfXml)) !== null) {
    const id = getAttr(m[1], "id"), href = getAttr(m[1], "href");
    if (id && href) manifest[id] = { href, type: getAttr(m[1], "media-type") || "", props: getAttr(m[1], "properties") || "" };
  }

  // Extract cover image
  let coverDataUrl = null;
  try {
    // Try manifest cover-image property first
    const coverId = Object.keys(manifest).find(k =>
      manifest[k].props.toLowerCase().includes("cover-image") ||
      k.toLowerCase() === "cover" ||
      manifest[k].href.toLowerCase().includes("cover")
    );
    if (coverId) {
      const coverHref = resolveHref(opfDir, manifest[coverId].href);
      const coverEntry = coverHref ? zipFind(zip, coverHref) : null;
      if (coverEntry) {
        const coverData = await coverEntry.async("base64");
        const mtype = manifest[coverId].type || "image/jpeg";
        coverDataUrl = `data:${mtype};base64,${coverData}`;
      }
    }
    // Fallback: look for cover in OPF meta
    if (!coverDataUrl) {
      const metaCoverM = opfXml.match(/<meta\s[^>]*name\s*=\s*["']cover["'][^>]*content\s*=\s*["']([^"']+)["']/i)
                       || opfXml.match(/<meta\s[^>]*content\s*=\s*["']([^"']+)["'][^>]*name\s*=\s*["']cover["']/i);
      if (metaCoverM && manifest[metaCoverM[1]]) {
        const coverHref = resolveHref(opfDir, manifest[metaCoverM[1]].href);
        const coverEntry = coverHref ? zipFind(zip, coverHref) : null;
        if (coverEntry) {
          const coverData = await coverEntry.async("base64");
          const mtype = manifest[metaCoverM[1]].type || "image/jpeg";
          coverDataUrl = `data:${mtype};base64,${coverData}`;
        }
      }
    }
  } catch(e) { /* cover extraction failed, use gradient */ }

  const spineHrefs = [];
  const itemrefRe = /<itemref\s([^>]+?)\/?>/gi;
  while ((m = itemrefRe.exec(opfXml)) !== null) {
    const idref = getAttr(m[1], "idref"); if (!idref || !manifest[idref]) continue;
    const item = manifest[idref], t = item.type.toLowerCase(), ext = item.href.split(".").pop().toLowerCase();
    if (t.includes("html") || t.includes("xhtml") || ["html","xhtml","htm"].includes(ext) || t === "" || t === "application/xml") {
      const r = resolveHref(opfDir, item.href); if (r && !spineHrefs.includes(r)) spineHrefs.push(r);
    }
  }

  const rawFiles = await Promise.all(spineHrefs.map(async (href) => {
    const entry = zipFind(zip, href); return entry ? { href, html: await entry.async("string") } : null;
  }));

  const allPages = [];

  for (const f of rawFiles) {
    if (!f) continue;
    const blocks = htmlToBlocks(f.html);
    if (!blocks.some((b) => b.text.trim().length > 5)) continue;
    for (const pg of splitBlocksIntoPages(blocks)) allPages.push(pg);
  }

  if (allPages.length === 0) throw new Error("Could not extract any text");
  return { title: epubTitle, author: epubAuthor, pages: allPages, chapters: deriveChaptersFromPages(allPages), coverDataUrl };
}

// ============================================================================
// READING STREAK & SESSION TRACKING
// ============================================================================
function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function startReadingSession(bookId) {
  state.sessionStart = Date.now();
  state.sessionBookId = bookId;
}

function endReadingSession() {
  if (!state.sessionStart || !state.sessionBookId) return;
  const mins = (Date.now() - state.sessionStart) / 60000;
  const key = todayKey();
  state.readingLog[key] = (state.readingLog[key] || 0) + mins;
  
  // Track per-book reading
  const bookKey = `booklog_${state.sessionBookId}_${key}`;
  const existing = parseFloat(localStorage.getItem(bookKey) || "0");
  localStorage.setItem(bookKey, String(existing + mins));
  
  saveReadingLog();
  state.sessionStart = null;
  state.sessionBookId = null;
}

async function saveReadingLog() {
  await window.storage.set("reading_log", JSON.stringify(state.readingLog));
}

function getStreakDays() {
  // Returns array of last 7 days with filled status
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const mins = state.readingLog[key] || 0;
    days.push({ key, mins, filled: mins >= 5, isToday: i === 0 });
  }
  return days;
}

function getCurrentStreak() {
  let streak = 0;
  const d = new Date();
  // Check today first
  const todayMins = state.readingLog[d.toISOString().slice(0, 10)] || 0;
  if (todayMins < 5) {
    // Check yesterday to see if streak is intact
    d.setDate(d.getDate() - 1);
  }
  while (true) {
    const key = d.toISOString().slice(0, 10);
    if ((state.readingLog[key] || 0) >= 5) { streak++; d.setDate(d.getDate() - 1); }
    else break;
  }
  return streak;
}

function renderStreakDots() {
  const days = getStreakDays();
  const dotsEl = document.getElementById("streak-dots");
  const countEl = document.getElementById("streak-count-label");
  if (!dotsEl) return;
  dotsEl.innerHTML = days.map(d => {
    let cls = "streak-dot";
    if (d.filled) cls += " filled";
    else if (d.isToday) cls += " today-empty";
    const label = d.filled ? "✓" : (d.isToday ? "·" : "");
    return `<div class="${cls}" title="${d.key}: ${Math.round(d.mins)}m">${label}</div>`;
  }).join("");
  const streak = getCurrentStreak();
  countEl.textContent = `${streak} day streak`;
}

// ============================================================================
// APP LOGIC & RENDERING
// ============================================================================

async function initApp() {
  const libMeta = await window.storage.get("library_meta");
  if (libMeta) state.library = JSON.parse(libMeta.value);

  const themeData = await window.storage.get("app_theme");
  if (themeData) {
    const parsed = JSON.parse(themeData.value);
    state.themeKey = parsed.themeKey || "dark";
    state.customThemes = parsed.customThemes || {};
    if (parsed.tapToTurn !== undefined) state.tapToTurn = parsed.tapToTurn;
    if (parsed.twoPage !== undefined) state.twoPage = parsed.twoPage;
    if (parsed.highlightWords !== undefined) state.highlightWords = parsed.highlightWords;
    if (parsed.underlineLine !== undefined) state.underlineLine = parsed.underlineLine;
    if (parsed.connectedFolder !== undefined) state.connectedFolder = parsed.connectedFolder;
    if (parsed.ollamaUrl !== undefined) state.ollamaUrl = parsed.ollamaUrl;
    if (parsed.ollamaModel !== undefined) state.ollamaModel = parsed.ollamaModel;
  }

  const readingLogData = await window.storage.get("reading_log");
  if (readingLogData) state.readingLog = JSON.parse(readingLogData.value);

  applyTheme(state.themeKey);
  renderLibrary();
  renderStreakDots();

  // Load saved notes
  const notesData = await window.storage.get("reader_notes");
  if (notesData) { try { state.notes = JSON.parse(notesData.value); } catch {} }

  // Initialize text selection toolbar
  initSelectionToolbar();

  // Library search with results dropdown
  const searchInput = document.getElementById("library-search");
  searchInput.oninput = (e) => {
    state.searchQuery = e.target.value.toLowerCase();
    if (state.searchQuery.length > 0) renderSearchDropdown();
    else closeSearchDropdown();
    renderLibrary();
  };
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeSearchDropdown(); searchInput.blur(); }
    if (e.key === "Enter") {
      const first = document.querySelector(".search-result-item");
      if (first) first.click();
    }
  });
  searchInput.addEventListener("focus", () => {
    if (state.searchQuery.length > 0) renderSearchDropdown();
  });

  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      searchInput.focus(); searchInput.select();
    }
  });

  document.getElementById("btn-add-book").onclick = () => document.getElementById("file-input").click();
  document.getElementById("btn-settings").onclick = () => openModal("settings-modal");
  document.getElementById("btn-close-settings").onclick = () => closeModal("settings-modal");
  document.getElementById("btn-exit-reader").onclick = exitReader;
  document.getElementById("btn-profile").onclick = openProfile;
  document.getElementById("btn-close-profile").onclick = () => closeModal("profile-modal");

  document.getElementById("file-input").onchange = handleFileUpload;
  document.getElementById("folder-input").onchange = handleFolderSelect;
  document.getElementById("audio-input").onchange = handleAudioUpload;

  document.querySelectorAll(".tab").forEach(t => t.onclick = (e) => switchModalTab(e.target.dataset.tab));

  // Library tabs
  document.querySelectorAll(".lib-tab").forEach(t => t.onclick = (e) => {
    const tab = e.target.dataset.libtab;
    state.activeLibTab = tab;
    document.querySelectorAll(".lib-tab").forEach(x => x.classList.toggle("active", x.dataset.libtab === tab));
    document.querySelectorAll(".lib-tab-panel").forEach(p => p.classList.toggle("active", p.id === `tab-${tab}`));
    if (tab === "audiobooks") renderAudiobooks();
  });

  // Reader listeners
  document.getElementById("btn-prev-page").onclick = prevPage;
  document.getElementById("btn-next-page").onclick = nextPage;
  document.getElementById("tap-zone-prev").onclick = prevPage;
  document.getElementById("tap-zone-next").onclick = nextPage;
  document.getElementById("btn-toggle-audio").onclick = toggleAudio;
  document.getElementById("btn-upload-audio").onclick = () => document.getElementById("audio-input").click();
  document.getElementById("btn-reader-notes").onclick = openNotesViewer;
  document.getElementById("btn-reader-settings").onclick = () => document.getElementById("reader-settings-panel").classList.toggle("hidden");
  document.getElementById("btn-chapter-drop").onclick = () => {
    document.getElementById("chapter-dropdown").classList.toggle("hidden");
    document.getElementById("chapter-search").value = "";
    buildChapterDropdown();
  };

  window.addEventListener("keydown", (e) => {
    if (state.view !== "reader") return;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") nextPage();
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") prevPage();
    else if (e.key === "Escape") {
      document.getElementById("reader-settings-panel").classList.add("hidden");
      document.getElementById("chapter-dropdown").classList.add("hidden");
    }
  });

  document.getElementById("audio-player").onended = () => { state.isPlaying = false; updateAudioBtn(); };

  // Keyboard shortcut hint in search bar
  const isMac = navigator.platform.toUpperCase().includes("MAC");
  document.querySelector(".search-shortcut").textContent = isMac ? "⌘K" : "Ctrl+K";
}

// ============================================================================
// SEARCH DROPDOWN
// ============================================================================
function renderSearchDropdown() {
  const drop = document.getElementById("search-results-dropdown");
  const q = state.searchQuery;
  const results = state.library.filter(b =>
    b.title.toLowerCase().includes(q) || (b.author && b.author.toLowerCase().includes(q))
  ).slice(0, 6);

  if (results.length === 0) {
    drop.innerHTML = `<div class="search-no-results">No books found for "${q}"</div>`;
  } else {
    drop.innerHTML = results.map(b => {
      const [c1, c2] = generateCoverColor(b.title);
      const coverHtml = b.coverDataUrl
        ? `<img src="${b.coverDataUrl}" alt="">`
        : `<div style="width:100%;height:100%;background:linear-gradient(135deg,${c1},${c2});display:flex;align-items:center;justify-content:center;font-size:7px;color:rgba(255,255,255,0.7);font-weight:700;text-align:center;padding:2px;">${b.title.slice(0,8)}</div>`;
      const fmt = (b.format === "epub" || b.format === "epub3") ? "EPUB" : (b.format?.toUpperCase() || "TXT");
      const pct = b.totalPages > 1 ? Math.round((b.currentPage / (b.totalPages - 1)) * 100) : 0;
      return `<div class="search-result-item" data-id="${b.id}">
        <div class="search-result-cover">${coverHtml}</div>
        <div class="search-result-info">
          <div class="search-result-title">${b.title}</div>
          ${b.author ? `<div class="search-result-author">${b.author}</div>` : ""}
        </div>
        <span class="search-result-badge">${pct}%</span>
        <span class="search-result-badge">${fmt}</span>
      </div>`;
    }).join("");

    drop.querySelectorAll(".search-result-item").forEach(el => {
      el.onclick = () => {
        const book = state.library.find(b => b.id === el.dataset.id);
        if (book) { closeSearchDropdown(); openBook(book); }
      };
    });
  }
  drop.classList.remove("hidden");
}

function closeSearchDropdown() {
  document.getElementById("search-results-dropdown").classList.add("hidden");
}

function switchView(view) {
  state.view = view;
  document.querySelectorAll(".view").forEach(el => el.classList.remove("active"));
  document.getElementById(`${view}-view`).classList.add("active");
}

function applyTheme(key) {
  const allThemes = { ...BUILT_IN_THEMES, ...state.customThemes };
  const theme = allThemes[key] || BUILT_IN_THEMES.dark;
  const root = document.documentElement;
  Object.keys(theme).forEach(prop => root.style.setProperty(`--${prop}`, theme[prop]));
}

function savePreferences() {
  window.storage.set("app_theme", JSON.stringify({
    themeKey: state.themeKey, customThemes: state.customThemes,
    tapToTurn: state.tapToTurn, twoPage: state.twoPage,
    highlightWords: state.highlightWords, underlineLine: state.underlineLine,
    connectedFolder: state.connectedFolder,
    ollamaUrl: state.ollamaUrl, ollamaModel: state.ollamaModel
  }));
}

async function renderLibrary() {
  const grid = document.getElementById("library-grid");
  grid.innerHTML = "";

  // Always show all books in the grid regardless of search query
  const displayLibrary = state.library;

  if (displayLibrary.length === 0) {
    document.getElementById("empty-state").classList.remove("hidden");
    document.getElementById("library-header-text").classList.add("hidden");
  } else {
    document.getElementById("empty-state").classList.add("hidden");
    document.getElementById("library-header-text").classList.remove("hidden");
    document.getElementById("library-count").textContent = `${displayLibrary.length} book${displayLibrary.length !== 1 ? "s" : ""}`;
  }

  displayLibrary.forEach(book => {
    const el = createBookCard(book);
    grid.appendChild(el);
  });
  renderStreakDots();
}

function renderAudiobooks() {
  const grid = document.getElementById("audiobook-grid");
  const empty = document.getElementById("audiobook-empty-state");
  const count = document.getElementById("audiobook-count");
  grid.innerHTML = "";
  const audiobBooks = state.library.filter(b => b.hasAudio);
  count.textContent = `${audiobBooks.length} audiobook${audiobBooks.length !== 1 ? "s" : ""}`;
  if (audiobBooks.length === 0) {
    empty.classList.remove("hidden"); return;
  }
  empty.classList.add("hidden");
  audiobBooks.forEach(book => {
    const [c1, c2] = generateCoverColor(book.title);
    const el = document.createElement("div");
    el.className = "audiobook-card";
    const thumbHtml = book.coverDataUrl
      ? `<img src="${book.coverDataUrl}" alt="">`
      : `<div style="width:44px;height:44px;background:linear-gradient(135deg,${c1},${c2});border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:9px;color:rgba(255,255,255,0.7);font-weight:700;text-align:center;padding:4px;">${book.title.slice(0,6)}</div>`;
    el.innerHTML = `
      <div class="audiobook-thumb">${thumbHtml}</div>
      <div class="audiobook-info">
        <div class="audiobook-title">${book.title}</div>
        ${book.author ? `<div class="audiobook-author">${book.author}</div>` : ""}
      </div>
      <div class="audiobook-play-btn">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5"/><polygon points="10,8 17,12 10,16" fill="currentColor"/></svg>
      </div>
    `;
    el.onclick = () => openBook(book, true); // open in reader + auto-play
    grid.appendChild(el);
  });
}

function createBookCard(book) {
  const [c1, c2] = generateCoverColor(book.title);
  const pct = book.totalPages > 1 ? (book.currentPage / (book.totalPages - 1)) * 100 : 0;
  const fmt = (book.format === "epub" || book.format === "epub3") ? "EPUB" : (book.format?.toUpperCase() || "TXT");

  const el = document.createElement("div");
  el.className = "book-card-container";

  const coverContent = book.coverDataUrl
    ? `<img src="${book.coverDataUrl}" alt="${book.title}">`
    : `<div class="cover-spine"></div><div class="cover-crease"></div><div class="cover-edge"></div>
       <div class="cover-title">${book.title}</div>
       ${book.author ? `<div class="cover-author">${book.author}</div>` : ""}`;

  el.innerHTML = `
    <div class="book-cover" style="--c1:${c1}; --c2:${c2}">
      ${coverContent}
      <div class="cover-badge">${fmt}</div>
      ${book.hasAudio ? `<div class="cover-audio">🎧</div>` : ""}
      <div class="cover-prog-bg"><div class="cover-prog-fill" style="width:${pct}%"></div></div>
    </div>
    <div class="book-meta">
      <div class="meta-text">
        <div class="meta-title">${book.title}</div>
        ${book.author ? `<div class="meta-author">${book.author}</div>` : ""}
        <div class="meta-prog-row">
          <div class="meta-prog-track"><div class="meta-prog-fill" style="width:${pct}%"></div></div>
          <span class="meta-prog-pct">${Math.round(pct)}%</span>
        </div>
      </div>
      <button class="btn-dots">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><circle cx="3" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="13" cy="8" r="1.5"/></svg>
      </button>
    </div>
    <div class="context-menu hidden">
      <button class="ctx-item lookup-book-btn">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="6.5" cy="6.5" r="4" stroke="currentColor" stroke-width="1.5"/><line x1="9.8" y1="9.8" x2="14" y2="14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        Look up ${book.title.length > 22 ? book.title.slice(0,22)+'…' : book.title}
      </button>
      ${book.author ? `<button class="ctx-item lookup-author-btn">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5.5" r="2.5" stroke="currentColor" stroke-width="1.4"/><path d="M2.5 13c0-2.485 2.462-4.5 5.5-4.5s5.5 2.015 5.5 4.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
        Look up ${book.author.length > 20 ? book.author.slice(0,20)+'…' : book.author}
      </button>` : ''}
      <button class="ctx-item reset-btn">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8a5 5 0 1 1 1 3.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><polyline points="1,5 3,8 6,6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Reset progress
      </button>
      <button class="ctx-item danger delete-btn">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M6 4V2h4v2M5 4l1 9h4l1-9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Delete book
      </button>
    </div>
  `;

  el.querySelector(".book-cover").onclick = () => openBook(book);
  const menu = el.querySelector(".context-menu");
  el.querySelector(".btn-dots").onclick = (e) => {
    e.stopPropagation();
    // Close all other menus first
    document.querySelectorAll(".context-menu").forEach(m => { if (m !== menu) m.classList.add("hidden"); });
    const wasHidden = menu.classList.contains("hidden");
    menu.classList.toggle("hidden");
    if (wasHidden) {
      // Smart positioning: measure available space and position above or below
      const btnRect = e.currentTarget.getBoundingClientRect();
      // Show temporarily to measure size
      menu.style.top = "-9999px"; menu.style.left = "-9999px";
      const menuH = menu.offsetHeight || 170;
      const menuW = menu.offsetWidth || 215;
      const spaceBelow = window.innerHeight - btnRect.bottom - 8;
      const spaceAbove = btnRect.top - 8;
      // Horizontal: center on button, clamp to viewport
      let left = btnRect.left + btnRect.width / 2 - menuW / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - menuW - 8));
      menu.style.left = `${left}px`;
      if (spaceBelow >= menuH || spaceBelow >= spaceAbove) {
        // Open downward
        menu.style.top = `${btnRect.bottom + 6}px`;
        menu.style.bottom = "auto";
      } else {
        // Open upward
        menu.style.bottom = `${window.innerHeight - btnRect.top + 6}px`;
        menu.style.top = "auto";
      }
    }
  };
  el.querySelector(".reset-btn").onclick = (e) => { e.stopPropagation(); resetBookProgress(book.id); menu.classList.add("hidden"); };
  el.querySelector(".delete-btn").onclick = (e) => { e.stopPropagation(); deleteBook(book.id); menu.classList.add("hidden"); };
  el.querySelector(".lookup-book-btn")?.addEventListener("click", (e) => {
    e.stopPropagation(); menu.classList.add("hidden");
    window.open(`https://www.google.com/search?q=${encodeURIComponent(book.title + " book")}`, "_blank");
  });
  el.querySelector(".lookup-author-btn")?.addEventListener("click", (e) => {
    e.stopPropagation(); menu.classList.add("hidden");
    window.open(`https://www.google.com/search?q=${encodeURIComponent(book.author + " author")}`, "_blank");
  });

  return el;
}

async function openBook(book, autoPlay = false) {
  document.getElementById("loading-state").classList.remove("hidden");
  const pages = await loadBookContent(book.id);
  document.getElementById("loading-state").classList.add("hidden");

  if (pages) {
    state.activeBook = book;
    state.pages = pages;
    state.currentPage = book.currentPage || 0;

    const audSrc = await window.storage.get(`audio_${book.id}`);
    state.audioSrc = audSrc ? audSrc.value : null;
    const player = document.getElementById("audio-player");
    if (state.audioSrc) player.src = state.audioSrc;
    updateAudioBtn();

    if (autoPlay && state.audioSrc) {
      player.play(); state.isPlaying = true; updateAudioBtn();
    }

    switchView("reader");
    renderReader();
    startReadingSession(book.id);
  }
}

function exitReader() {
  endReadingSession();
  state.activeBook = null;
  state.pages = [];
  document.getElementById("audio-player").pause();
  state.isPlaying = false;
  switchView("library");
  renderLibrary();
}

function renderReader() {
  document.getElementById("reader-book-title").textContent = state.activeBook.title;
  buildChapterDropdown();
  buildReaderSettings();
  updateReaderNav();
  renderPage();
  applyAccessibilityClasses();
}

function applyAccessibilityClasses() {
  const card = document.getElementById("reader-card");
  card.classList.toggle("highlight-words", state.highlightWords);
  card.classList.toggle("underline-line", state.underlineLine);
}

// Only show chapter label when title contains "chapter" keyword
function buildChapterTitle(title) {
  return title; // Display as-is, no "Chapter X:" prefix for non-chapter sections
}

function buildChapterDropdown() {
  const chaps = state.activeBook.chapters || [];
  const list = document.getElementById("chapter-list");
  const q = document.getElementById("chapter-search")?.value.trim().toLowerCase() || "";

  list.innerHTML = "";
  document.getElementById("drop-book-title").textContent = state.activeBook.title;
  document.getElementById("drop-book-stats").textContent = `${chaps.length} chapter(s) · ${state.pages.length} pages`;

  const activeIdx = chaps.reduce((best, ch, i) => ch.pageIndex <= state.currentPage ? i : best, 0);

  // Check if query is a page number
  const pageNumMatch = q.match(/^p(?:age)?\s*(\d+)$|^(\d+)$/);
  if (pageNumMatch) {
    const pageNum = parseInt(pageNumMatch[1] || pageNumMatch[2], 10) - 1; // convert to 0-indexed
    if (pageNum >= 0 && pageNum < state.pages.length) {
      const el = document.createElement("div");
      el.className = "chapter-item";
      el.innerHTML = `<div class="ch-flex"><div class="ch-title">→ Jump to Page ${pageNum + 1}</div></div><div class="ch-sub">Page ${pageNum + 1} of ${state.pages.length}</div>`;
      el.onclick = () => {
        state.currentPage = pageNum;
        updateProgress(state.currentPage);
        document.getElementById("chapter-dropdown").classList.add("hidden");
      };
      list.appendChild(el);
      return;
    }
  }

  chaps.forEach((ch, i) => {
    if (q && !ch.title.toLowerCase().includes(q)) return;

    const nextP = chaps[i+1]?.pageIndex ?? state.pages.length;
    const len = nextP - ch.pageIndex;
    const el = document.createElement("div");
    el.className = `chapter-item ${i === activeIdx ? "active" : ""}`;
    el.innerHTML = `<div class="ch-flex"><div class="ch-title">${ch.title}</div><span class="ch-pgs">${len}p</span></div><div class="ch-sub">Page ${(ch.pageIndex||0)+1}</div>`;
    el.onclick = () => {
      state.currentPage = ch.pageIndex || 0;
      updateProgress(state.currentPage);
      document.getElementById("chapter-dropdown").classList.add("hidden");
    };
    list.appendChild(el);
  });

  document.getElementById("chapter-search").oninput = buildChapterDropdown;
}

// Re-paginate the current book when font settings change
async function repaginateCurrentBook() {
  if (!state.activeBook) return;
  // Store the current reading position as a fraction
  const fraction = state.pages.length > 1 ? state.currentPage / (state.pages.length - 1) : 0;

  // Reload raw content and re-split
  const pages = await loadBookContent(state.activeBook.id);
  if (!pages) return;

  // The stored pages are already split blocks — we need to flatten them back to blocks
  // and re-split with new settings
  const allBlocks = [];
  for (const page of pages) {
    if (Array.isArray(page)) {
      for (const block of page) {
        // Merge consecutive same-type blocks to avoid over-splitting
        const last = allBlocks[allBlocks.length - 1];
        if (last && last.type === "para" && block.type === "para") {
          last.text += " " + block.text;
        } else {
          allBlocks.push({ ...block });
        }
      }
    }
  }

  const newPages = splitBlocksIntoPages(allBlocks);
  state.pages = newPages;
  state.activeBook.chapters = deriveChaptersFromPages(newPages);
  state.activeBook.totalPages = newPages.length;

  // Restore position proportionally
  state.currentPage = Math.min(Math.round(fraction * (newPages.length - 1)), newPages.length - 1);
  state.activeBook.currentPage = state.currentPage;
  const idx = state.library.findIndex(b => b.id === state.activeBook.id);
  if (idx > -1) {
    state.library[idx].currentPage = state.currentPage;
    state.library[idx].totalPages = newPages.length;
    state.library[idx].chapters = state.activeBook.chapters;
  }
  saveLibrary();
}

function buildReaderSettings() {
  const panel = document.getElementById("reader-settings-panel");
  const tapOn = state.tapToTurn;
  const twoOn = state.twoPage;
  const hlOn = state.highlightWords;
  const ulOn = state.underlineLine;

  panel.innerHTML = `
    <div class="section-label">DISPLAY</div>
    <label style="display:block; margin-bottom:12px; font-size:12px;">
      <div style="display:flex; justify-content:space-between; margin-bottom:5px;"><span>Font Size</span><span style="color:var(--textDim)">${state.fontSize}px</span></div>
      <input type="range" id="fs-slider" min="14" max="28" step="1" value="${state.fontSize}">
    </label>
    <label style="display:block; margin-bottom:12px; font-size:12px;">
      <div style="display:flex; justify-content:space-between; margin-bottom:5px;"><span>Line Spacing</span><span style="color:var(--textDim)">${state.lineSpacing}</span></div>
      <input type="range" id="ls-slider" min="1.4" max="2.4" step="0.1" value="${state.lineSpacing}">
    </label>
    <label style="display:block; font-size:12px;">
      <div style="margin-bottom:5px;">Font</div>
      <select id="font-select">
        <option value="Georgia, serif" ${state.fontFamily.includes("Georgia")?"selected":""}>Georgia</option>
        <option value="'Palatino Linotype', serif" ${state.fontFamily.includes("Palatino")?"selected":""}>Palatino</option>
        <option value="system-ui, sans-serif" ${state.fontFamily.includes("system")?"selected":""}>System UI</option>
      </select>
    </label>
    <div style="margin-top:14px; padding-top:14px; border-top:1px solid var(--borderSubtle)">
      <div class="section-label">NAVIGATION & LAYOUT</div>
      <label style="display:flex; align-items:center; justify-content:space-between; cursor:pointer; margin-bottom:10px;">
        <div style="font-size:12px; font-weight:500;">Tap margins to turn</div>
        <div id="tap-toggle" class="toggle-track ${tapOn?"on":"off"}"><div class="toggle-thumb"></div></div>
      </label>
      <label style="display:flex; align-items:center; justify-content:space-between; cursor:pointer;">
        <div style="font-size:12px; font-weight:500;">Two-page spread</div>
        <div id="two-page-toggle" class="toggle-track ${twoOn?"on":"off"}"><div class="toggle-thumb"></div></div>
      </label>
    </div>
    <div style="margin-top:14px; padding-top:14px; border-top:1px solid var(--borderSubtle)">
      <div class="section-label">ACCESSIBILITY</div>
      <label style="display:flex; align-items:center; justify-content:space-between; cursor:pointer; margin-bottom:10px;">
        <div style="font-size:12px; font-weight:500;">Highlight words on hover</div>
        <div id="hl-toggle" class="toggle-track ${hlOn?"on":"off"}"><div class="toggle-thumb"></div></div>
      </label>
      <label style="display:flex; align-items:center; justify-content:space-between; cursor:pointer;">
        <div style="font-size:12px; font-weight:500;">Underline current line</div>
        <div id="ul-toggle" class="toggle-track ${ulOn?"on":"off"}"><div class="toggle-thumb"></div></div>
      </label>
    </div>
  `;

  document.getElementById("fs-slider").oninput = async (e) => {
    state.fontSize = +e.target.value;
    e.target.previousElementSibling.lastElementChild.textContent = `${state.fontSize}px`;
    await repaginateCurrentBook();
    renderPage();
  };
  document.getElementById("ls-slider").oninput = async (e) => {
    state.lineSpacing = +e.target.value;
    e.target.previousElementSibling.lastElementChild.textContent = state.lineSpacing;
    await repaginateCurrentBook();
    renderPage();
  };
  document.getElementById("font-select").onchange = async (e) => {
    state.fontFamily = e.target.value;
    await repaginateCurrentBook();
    renderPage();
  };

  document.getElementById("tap-toggle").onclick = () => {
    state.tapToTurn = !state.tapToTurn;
    buildReaderSettings(); updateReaderNav(); savePreferences();
  };
  document.getElementById("two-page-toggle").onclick = async () => {
    state.twoPage = !state.twoPage;
    await repaginateCurrentBook();
    buildReaderSettings(); renderPage(); savePreferences();
  };
  document.getElementById("hl-toggle").onclick = () => {
    state.highlightWords = !state.highlightWords;
    buildReaderSettings(); applyAccessibilityClasses(); savePreferences();
  };
  document.getElementById("ul-toggle").onclick = () => {
    state.underlineLine = !state.underlineLine;
    buildReaderSettings(); applyAccessibilityClasses(); savePreferences();
  };
}

// Wrap words in spans for hover-highlight if accessibility enabled
function wrapWordsInSpans(text) {
  return text.split(/(\s+)/).map(token => {
    if (/\s/.test(token)) return token;
    const clean = token.replace(/[^\w'-]/g, "");
    return `<span class="word" data-word="${clean}">${token}</span>`;
  }).join("");
}

// ============================================================================
// TEXT SELECTION TOOLBAR (Summarize + Add Note)
// ============================================================================
let _selToolbarEl = null;
let _notePanelEl = null;
let _summaryPopupEl = null;
let _selectionTimer = null;

// Notes stored in state
if (!state.notes) state.notes = {}; // { bookId: [{id, quote, text, page, createdAt}] }

function removeSelToolbar() {
  if (_selToolbarEl) { _selToolbarEl.remove(); _selToolbarEl = null; }
}
function removeNotePanel() {
  if (_notePanelEl) { _notePanelEl.remove(); _notePanelEl = null; }
}
function removeSummaryPopup() {
  if (_summaryPopupEl) { _summaryPopupEl.remove(); _summaryPopupEl = null; }
}

function initSelectionToolbar() {
  document.addEventListener("selectionchange", () => {
    clearTimeout(_selectionTimer);
    _selectionTimer = setTimeout(() => {
      if (state.view !== "reader") return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) { return; }
      const text = sel.toString().trim();
      if (text.length < 3) { removeSelToolbar(); return; }

      // Only show if within reader card
      const card = document.getElementById("reader-card");
      if (!card) return;
      try {
        const range = sel.getRangeAt(0);
        if (!card.contains(range.commonAncestorContainer)) { removeSelToolbar(); return; }
        showSelectionToolbar(text, range);
      } catch {}
    }, 250);
  });
}

function showSelectionToolbar(selectedText, range) {
  removeSelToolbar();
  const rect = range.getBoundingClientRect();
  if (!rect.width && !rect.height) return;

  const toolbar = document.createElement("div");
  toolbar.className = "selection-toolbar";
  _selToolbarEl = toolbar;

  toolbar.innerHTML = `
    <button class="sel-btn" id="sel-summarize">
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><rect x="1" y="3" width="14" height="2" rx="1" fill="currentColor" opacity=".7"/><rect x="1" y="7" width="10" height="2" rx="1" fill="currentColor" opacity=".9"/><rect x="1" y="11" width="7" height="2" rx="1" fill="currentColor" opacity=".6"/></svg>
      Summarize
    </button>
    <button class="sel-btn" id="sel-add-note">
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 2h12v10H8l-4 3V2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><line x1="5" y1="6" x2="11" y2="6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><line x1="5" y1="9" x2="9" y2="9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
      Add Note
    </button>
  `;
  document.body.appendChild(toolbar);

  // Position above the selection, centered
  const tbW = toolbar.offsetWidth || 180;
  const tbH = toolbar.offsetHeight || 36;
  let left = rect.left + rect.width / 2 - tbW / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - tbW - 8));
  let top = rect.top - tbH - 10;
  if (top < 8) top = rect.bottom + 10;

  toolbar.style.left = `${left}px`;
  toolbar.style.top = `${top}px`;

  toolbar.querySelector("#sel-summarize").onclick = (e) => {
    e.stopPropagation();
    const currentSel = window.getSelection();
    const txt = currentSel && !currentSel.isCollapsed ? currentSel.toString().trim() : selectedText;
    removeSelToolbar();
    showSummaryPopup(txt, rect);
  };
  toolbar.querySelector("#sel-add-note").onclick = (e) => {
    e.stopPropagation();
    const currentSel = window.getSelection();
    const txt = currentSel && !currentSel.isCollapsed ? currentSel.toString().trim() : selectedText;
    removeSelToolbar();
    showAddNotePanel(txt, rect);
  };
}

async function showSummaryPopup(text, anchorRect) {
  removeSummaryPopup();
  const popup = document.createElement("div");
  popup.className = "summary-popup";
  _summaryPopupEl = popup;

  const excerpt = text.length > 120 ? text.slice(0, 120) + "…" : text;
  popup.innerHTML = `
    <div class="summary-popup-header">
      <span class="summary-popup-title">✦ AI Summary</span>
      <button class="summary-popup-close">×</button>
    </div>
    <div class="summary-popup-quote">"${excerpt}"</div>
    <div class="summary-popup-body" id="summary-body">
      <span class="summary-loading">Summarizing…</span>
    </div>
  `;
  document.body.appendChild(popup);

  const popW = popup.offsetWidth || 340;
  const popH = popup.offsetHeight || 180;
  let left = anchorRect.left + anchorRect.width / 2 - popW / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - popW - 8));
  let top = anchorRect.bottom + 10;
  if (top + popH > window.innerHeight - 8) top = anchorRect.top - popH - 10;
  if (top < 8) top = 8;
  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;

  popup.querySelector(".summary-popup-close").onclick = () => removeSummaryPopup();

  try {
    let summary = "";
    if (state.ollamaUrl) {
      // Use Ollama local LLM
      const model = state.ollamaModel || "llama3";
      const r = await fetch(`${state.ollamaUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt: `Summarize this passage from a book in 2–3 concise sentences:\n\n"${text}"\n\nSummary:`,
          stream: false
        })
      });
      if (r.ok) {
        const d = await r.json();
        summary = d?.response?.trim() || "Could not generate summary.";
      } else {
        throw new Error("Ollama error " + r.status);
      }
    } else {
      // Fallback: free Anthropic API
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 180,
          messages: [{ role: "user", content: `Summarize this passage from a book in 2–3 concise sentences:\n\n"${text}"` }]
        })
      });
      const data = await res.json();
      summary = data?.content?.[0]?.text || "Could not generate summary.";
    }
    const body = document.getElementById("summary-body");
    if (body) body.innerHTML = `<p style="margin:0;">${summary}</p>`;
  } catch {
    const body = document.getElementById("summary-body");
    if (body) body.innerHTML = `<span style="color:var(--textDim);font-size:12px;">Summary unavailable. ${state.ollamaUrl ? "Check Ollama connection." : "API unavailable."}</span>`;
  }
}

function showAddNotePanel(selectedText, anchorRect) {
  removeNotePanel();
  if (!state.activeBook) return;

  const panel = document.createElement("div");
  panel.className = "note-add-panel";
  _notePanelEl = panel;

  const excerpt = selectedText.length > 90 ? selectedText.slice(0, 90) + "…" : selectedText;
  panel.innerHTML = `
    <div class="note-panel-header">
      <span class="note-panel-title">Add Note</span>
      <button class="note-panel-close">×</button>
    </div>
    <div class="note-panel-quote">"${excerpt}"</div>
    <div class="note-panel-body">
      <textarea class="note-textarea" placeholder="Write your note…" rows="3"></textarea>
      <div class="note-panel-actions">
        <button class="note-cancel-btn">Cancel</button>
        <button class="note-save-btn">Save Note</button>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  // Position near selection
  const panW = panel.offsetWidth || 320;
  const panH = panel.offsetHeight || 180;
  let left = anchorRect.left + anchorRect.width / 2 - panW / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - panW - 8));
  let top = anchorRect.bottom + 10;
  if (top + panH > window.innerHeight - 8) top = anchorRect.top - panH - 10;
  if (top < 8) top = 8;
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;

  panel.querySelector(".note-panel-close").onclick = () => removeNotePanel();
  panel.querySelector(".note-cancel-btn").onclick = () => removeNotePanel();
  panel.querySelector(".note-save-btn").onclick = () => {
    const noteText = panel.querySelector(".note-textarea").value.trim();
    if (!noteText) { panel.querySelector(".note-textarea").focus(); return; }
    // Store note
    if (!state.notes) state.notes = {};
    if (!state.notes[state.activeBook.id]) state.notes[state.activeBook.id] = [];
    state.notes[state.activeBook.id].push({
      id: `note_${Date.now()}`,
      quote: selectedText.slice(0, 200),
      text: noteText,
      page: state.currentPage,
      createdAt: new Date().toISOString()
    });
    window.storage.set("reader_notes", JSON.stringify(state.notes));
    removeNotePanel();
    showToast(true, "Note saved");
    setTimeout(hideToast, 1200);
  };
  setTimeout(() => panel.querySelector(".note-textarea")?.focus(), 60);
}

// ============================================================================
// WORD LOOKUP POPUP
// ============================================================================
let _wordPopupEl = null;

function removeWordPopup() {
  if (_wordPopupEl) { _wordPopupEl.remove(); _wordPopupEl = null; }
}

function extractSentenceAround(fullText, word) {
  // Returns prev sentence + sentence containing word + next sentence for translation context
  const sentences = fullText.match(/[^.!?]+[.!?]+["'\u2019\u201d]?\s*/g) || [fullText];
  const wl = word.toLowerCase();
  let foundIdx = -1;
  for (let i = 0; i < sentences.length; i++) {
    if (sentences[i].toLowerCase().includes(wl)) { foundIdx = i; break; }
  }
  if (foundIdx === -1) {
    const idx = fullText.toLowerCase().indexOf(wl);
    if (idx === -1) return word;
    return fullText.slice(Math.max(0, idx - 50), idx + word.length + 50).trim();
  }
  const prev = foundIdx > 0 ? sentences[foundIdx - 1].trim() : "";
  const curr = sentences[foundIdx].trim();
  const next = foundIdx < sentences.length - 1 ? sentences[foundIdx + 1].trim() : "";
  return [prev, curr, next].filter(Boolean).join(" ");
}

function extractCurrentSentence(fullText, word) {
  const sentences = fullText.match(/[^.!?]+[.!?]+["'\u2019\u201d]?\s*/g) || [fullText];
  const wl = word.toLowerCase();
  for (const s of sentences) { if (s.toLowerCase().includes(wl)) return s.trim(); }
  return word;
}

function showWordPopup(word, anchorEl) {
  removeWordPopup();
  if (!word) return;

  // Grab surrounding sentence for context-aware translation
  const para = anchorEl.closest("p");
  const sentenceCtx = para ? extractSentenceAround(para.textContent || "", word) : word;

  const popup = document.createElement("div");
  popup.className = "word-popup";
  _wordPopupEl = popup;

  popup.innerHTML = `
    <div class="word-popup-actions">
      <button class="word-popup-btn" id="wp-define">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.5"/><line x1="5" y1="6" x2="11" y2="6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="5" y1="9" x2="9" y2="9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
        Define
      </button>
      <button class="word-popup-btn" id="wp-translate">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 4h6M5 2v2M3 7c0 1.5 1 2.5 2.5 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M9 6l3 8M11 10h2.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Translate
      </button>
    </div>
    <div class="word-popup-result" id="wp-result">
      <div class="wp-word">${word}</div>
      <div class="wp-def" style="color:var(--textDim); font-style:italic; font-size:11px;">Click Define or Translate</div>
    </div>
  `;

  document.body.appendChild(popup);

  // Position popup near the word
  const rect = anchorEl.getBoundingClientRect();
  let top = rect.bottom + 6, left = rect.left;
  if (left + 310 > window.innerWidth) left = window.innerWidth - 318;
  if (top + 200 > window.innerHeight) top = rect.top - 208;
  popup.style.top = `${top}px`;
  popup.style.left = `${left}px`;

  popup.querySelector("#wp-define").onclick = async () => {
    const res = document.getElementById("wp-result");
    res.innerHTML = `<div class="wp-loading">Looking up "${word}"…</div>`;
    try {
      const r = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`);
      if (!r.ok) throw new Error("not found");
      const data = await r.json();
      const entry = data[0];
      const meaning = entry?.meanings?.[0];
      const def = meaning?.definitions?.[0]?.definition || "No definition found.";
      const pos = meaning?.partOfSpeech || "";
      const phonetic = entry?.phonetic || "";
      res.innerHTML = `
        <div class="wp-word">${entry?.word || word} <span style="font-size:11px;color:var(--textDim);font-weight:400;">${phonetic}</span></div>
        ${pos ? `<div class="wp-pos">${pos}</div>` : ""}
        <div class="wp-def">${def}</div>
      `;
    } catch {
      res.innerHTML = `<div class="wp-error">No definition found for "${word}".</div>`;
    }
  };

  popup.querySelector("#wp-translate").onclick = () => {
    const res = document.getElementById("wp-result");
    const langs = [
      ["es","Spanish"],["fr","French"],["de","German"],["it","Italian"],
      ["pt","Portuguese"],["ja","Japanese"],["zh","Chinese"],["ko","Korean"],
      ["ru","Russian"],["ar","Arabic"],["hi","Hindi"],["nl","Dutch"],
    ];
    res.innerHTML = `
      <div style="font-size:10px;color:var(--textDim);font-style:italic;margin-bottom:6px;padding:4px 6px;background:var(--surfaceAlt);border-radius:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${sentenceCtx}">
        Context: "${sentenceCtx.slice(0,65)}${sentenceCtx.length>65?"…":""}"
      </div>
      <div class="word-popup-translate-row">
        <select id="wp-lang-select">
          ${langs.map(([code, name]) => `<option value="${code}">${name}</option>`).join("")}
        </select>
        <button class="word-popup-btn" id="wp-do-translate" style="flex:none;padding:5px 10px;border-radius:5px;border:1px solid var(--border);">Go</button>
      </div>
      <div id="wp-trans-result" class="wp-def" style="color:var(--textDim); font-style:italic; margin-top:4px;">Select a language above.</div>
    `;
    res.querySelector("#wp-do-translate").onclick = async () => {
      const lang = res.querySelector("#wp-lang-select").value;
      const out = res.querySelector("#wp-trans-result");
      out.innerHTML = `<span class="wp-loading">Translating…</span>`;
      try {
        // Use full sentence context for accurate translation, extract the word translation
        const textToTranslate = sentenceCtx.length > 6 ? sentenceCtx : word;
        const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(textToTranslate)}&langpair=en|${lang}`);
        const d = await r.json();
        const translatedSentence = d?.responseData?.translatedText || "";
        const quality = parseInt(d?.responseData?.match || "0");

        // Also get a single-word fallback translation for reference
        let wordOnly = "";
        if (textToTranslate !== word) {
          try {
            const r2 = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=en|${lang}`);
            const d2 = await r2.json();
            const t = d2?.responseData?.translatedText || "";
            if (t && t.toLowerCase() !== word.toLowerCase()) wordOnly = t;
          } catch {}
        }

        if (translatedSentence && translatedSentence.toLowerCase() !== textToTranslate.toLowerCase()) {
          out.style.fontStyle = "normal";
          out.innerHTML = `
            ${wordOnly ? `<div style="margin-bottom:6px;"><strong style="color:var(--text);font-size:14px;">${wordOnly}</strong> <span style="font-size:10px;color:var(--textDim);">(word)</span></div>` : ""}
            <div style="font-size:11px;color:var(--textMuted);line-height:1.55;border-left:2px solid var(--accent);padding-left:7px;font-style:italic;">${translatedSentence}</div>
            ${quality < 75 ? `<div style="font-size:9px;color:var(--textDim);margin-top:4px;">⚠ Low confidence translation</div>` : ""}
          `;
        } else {
          out.innerHTML = `<span class="wp-error">Translation unavailable for this language.</span>`;
        }
      } catch {
        out.innerHTML = `<span class="wp-error">Translation failed. Check your connection.</span>`;
      }
    };
  };
}

function attachWordClickListeners(container) {
  container.querySelectorAll(".word[data-word]").forEach(span => {
    span.style.cursor = "pointer";
    span.onclick = (e) => {
      e.stopPropagation();
      const word = span.dataset.word;
      if (!word || word.length < 2) return;
      showWordPopup(word, span);
    };

    // Underline current line: highlight words at same vertical position
    if (state.underlineLine) {
      span.addEventListener("mouseenter", () => {
        const rect = span.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        // Find all word spans in same paragraph
        const para = span.closest("p");
        if (!para) return;
        para.querySelectorAll(".word").forEach(w => {
          const wr = w.getBoundingClientRect();
          const wMidY = wr.top + wr.height / 2;
          // Same line = within half a line height vertically
          if (Math.abs(wMidY - midY) < rect.height * 0.6) {
            w.classList.add("same-line");
          } else {
            w.classList.remove("same-line");
          }
        });
      });
      span.addEventListener("mouseleave", () => {
        const para = span.closest("p");
        if (!para) return;
        para.querySelectorAll(".word.same-line").forEach(w => w.classList.remove("same-line"));
      });
    }
  });
}

function constructPageDOM(pageData, wrapWords) {
  const container = document.createElement("div");
  container.className = "reader-page";
  container.style.fontFamily = state.fontFamily;
  container.style.overflow = "hidden";

  if (typeof pageData === "string") {
    const txt = wrapWords ? wrapWordsInSpans(decodeEntities(pageData)) : decodeEntities(pageData);
    container.innerHTML = `<p style="color:var(--readerText); font-size:${state.fontSize}px; line-height:${state.lineSpacing}; margin:0; text-align:justify; word-break:break-word;">${txt}</p>`;
    return container;
  }

  const isChapterStart = pageData.every(b => b.type === "heading" || b.type === "subheading");
  if (isChapterStart) {
    const h = pageData.find((b) => b.type === "heading");
    const s = pageData.find((b) => b.type === "subheading");
    container.innerHTML = `
      <div style="color:var(--readerText); height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; padding:${Math.round(state.fontSize * 3)}px 0;">
        <div style="width:48px; height:2px; background:var(--accent); border-radius:1px; margin-bottom:${Math.round(state.fontSize * 2.5)}px; opacity:0.6;"></div>
        ${h ? `<div style="font-size:${Math.round(state.fontSize * 2.0)}px; font-weight:700; line-height:1.2; letter-spacing:-0.02em; margin-bottom:${s?Math.round(state.fontSize*1):0}px;">${h.text}</div>` : ""}
        ${s ? `<div style="font-size:${Math.round(state.fontSize * 1.2)}px; font-weight:400; line-height:1.4; opacity:0.65; font-style:italic; margin-top:${Math.round(state.fontSize*0.5)}px;">${s.text}</div>` : ""}
        <div style="width:48px; height:2px; background:var(--accent); border-radius:1px; margin-top:${Math.round(state.fontSize * 2.5)}px; opacity:0.6;"></div>
      </div>
    `;
    return container;
  }

  pageData.forEach((block, i) => {
    if (!block?.text?.trim()) return;
    const el = document.createElement(block.type === "para" ? "p" : "div");
    if (block.type === "heading") {
      el.style.cssText = `font-family:Georgia,serif; font-size:${Math.round(state.fontSize*1.4)}px; font-weight:700; line-height:1.25; margin-top:${i===0?0:Math.round(state.fontSize*1.8)}px; margin-bottom:${Math.round(state.fontSize*0.9)}px; padding-bottom:${Math.round(state.fontSize*0.4)}px; border-bottom:1px solid var(--borderSubtle);`;
    } else if (block.type === "subheading") {
      el.style.cssText = `font-family:Georgia,serif; font-size:${Math.round(state.fontSize*1.15)}px; font-weight:600; line-height:1.35; opacity:0.85; margin-top:${i===0?0:Math.round(state.fontSize*1.2)}px; margin-bottom:${Math.round(state.fontSize*0.55)}px;`;
    } else {
      const prevIsNonPara = i === 0 || pageData[i - 1]?.type !== "para";
      el.style.cssText = `font-size:${state.fontSize}px; line-height:${state.lineSpacing}; margin:0; margin-bottom:${prevIsNonPara?Math.round(state.fontSize*0.6):0}px; text-indent:${prevIsNonPara?0:"2em"}; text-align:justify; word-break:break-word; hyphens:auto;`;
    }
    if (wrapWords && block.type === "para") {
      el.innerHTML = wrapWordsInSpans(block.text);
    } else {
      el.textContent = block.text;
    }
    container.appendChild(el);
  });

  return container;
}

function renderPage() {
  removeWordPopup();
  removeSelToolbar();
  removeSummaryPopup();
  removeNotePanel();

  // Recalculate pages if font settings changed since last render
  if (state.activeBook && state._lastFontSize !== state.fontSize ||
      state._lastLineSpacing !== state.lineSpacing ||
      state._lastFontFamily !== state.fontFamily ||
      state._lastTwoPage !== state.twoPage) {
    // We need to re-split pages from the stored content
    // But pages are already split - just re-render what we have
    state._lastFontSize = state.fontSize;
    state._lastLineSpacing = state.lineSpacing;
    state._lastFontFamily = state.fontFamily;
    state._lastTwoPage = state.twoPage;
  }

  const page1 = state.pages[state.currentPage];
  const page2 = state.twoPage ? state.pages[state.currentPage + 1] : null;
  const card = document.getElementById("reader-card");
  card.innerHTML = "";

  card.classList.toggle("two-page", state.twoPage);
  applyAccessibilityClasses();

  if (!page1) return;

  const wrapW = state.highlightWords;

  if (state.twoPage) {
    const p1 = constructPageDOM(page1, wrapW);
    card.appendChild(p1);
    const divider = document.createElement("div");
    divider.className = "page-divider";
    card.appendChild(divider);
    const p2 = page2 ? constructPageDOM(page2, wrapW) : (() => { const e = document.createElement("div"); e.className="reader-page"; return e; })();
    card.appendChild(p2);
    if (wrapW) { attachWordClickListeners(p1); attachWordClickListeners(p2); }
    addBookmarkIcons(card);
  } else {
    const p1 = constructPageDOM(page1, wrapW);
    card.appendChild(p1);
    if (wrapW) attachWordClickListeners(p1);
    addBookmarkIcons(card);
  }
}

// Add bookmark icons where notes exist on this page
function addBookmarkIcons(card) {
  if (!state.activeBook || !state.notes) return;
  const notes = state.notes[state.activeBook.id] || [];
  const pageNotes = notes.filter(n => n.page === state.currentPage);
  if (pageNotes.length === 0) return;

  // Find paragraphs that contain the noted quote
  const paras = card.querySelectorAll("p");
  pageNotes.forEach(note => {
    const quote = note.quote.slice(0, 40).toLowerCase();
    for (const para of paras) {
      if (para.textContent.toLowerCase().includes(quote)) {
        // Insert bookmark icon at beginning of para
        const icon = document.createElement("span");
        icon.className = "note-bookmark-icon";
        icon.title = note.text;
        icon.innerHTML = `<svg width="11" height="14" viewBox="0 0 11 14" fill="none"><path d="M1 1h9v12l-4.5-3L1 13V1z" fill="var(--accent)" stroke="var(--accent)" stroke-width="1" stroke-linejoin="round"/></svg>`;
        para.insertBefore(icon, para.firstChild);
        break;
      }
    }
  });
}

function updateReaderNav() {
  const chaps = state.activeBook.chapters || [];
  const actChIdx = chaps.reduce((best, ch, i) => ch.pageIndex <= state.currentPage ? i : best, 0);

  const nextChap = chaps[actChIdx + 1];
  const endPage = nextChap ? nextChap.pageIndex : state.pages.length;
  const pagesLeft = endPage - state.currentPage;

  const pct = state.pages.length > 1 ? (state.currentPage / (state.pages.length - 1)) * 100 : 0;

  document.getElementById("page-indicator").textContent = `Page ${state.currentPage + 1} of ${state.pages.length} · ${Math.round(pct)}% · ${pagesLeft}p left`;
  document.getElementById("progress-bar").style.width = `${pct}%`;

  document.getElementById("btn-prev-page").disabled = state.currentPage === 0;
  document.getElementById("btn-next-page").disabled = state.currentPage >= state.pages.length - 1;

  if (state.tapToTurn) {
    document.getElementById("tap-zone-prev").classList.remove("hidden");
    document.getElementById("tap-zone-next").classList.remove("hidden");
  } else {
    document.getElementById("tap-zone-prev").classList.add("hidden");
    document.getElementById("tap-zone-next").classList.add("hidden");
  }

  if (chaps[actChIdx]) {
    document.getElementById("reader-chapter-title").textContent = chaps[actChIdx].title;
    buildChapterDropdown();
  }
}

function nextPage() {
  const step = state.twoPage ? 2 : 1;
  if (state.currentPage < state.pages.length - 1) {
    state.currentPage = Math.min(state.currentPage + step, state.pages.length - 1);
    updateProgress(state.currentPage);
  }
}

function prevPage() {
  const step = state.twoPage ? 2 : 1;
  if (state.currentPage > 0) {
    state.currentPage = Math.max(state.currentPage - step, 0);
    updateProgress(state.currentPage);
  }
}

function updateProgress(page) {
  state.activeBook.currentPage = page;
  const idx = state.library.findIndex(b => b.id === state.activeBook.id);
  if (idx > -1) state.library[idx].currentPage = page;
  saveLibrary();
  renderPage();
  updateReaderNav();
}

// ============================================================================
// DATA & FILE HANDLING
// ============================================================================
async function saveLibrary() {
  await window.storage.set("library_meta", JSON.stringify(state.library));
}

async function saveBookContent(id, pages) {
  const json = JSON.stringify(pages);
  if (json.length < MAX_SINGLE_KB) {
    await window.storage.set(`book_${id}_data`, json);
    await window.storage.set(`book_${id}_chunks`, "0");
    return;
  }
  const chunks = [];
  for (let i = 0; i < pages.length; i += CHUNK_SIZE) chunks.push(pages.slice(i, i + CHUNK_SIZE));
  await Promise.all(chunks.map((c, ci) => window.storage.set(`book_${id}_chunk_${ci}`, JSON.stringify(c))));
  await window.storage.set(`book_${id}_chunks`, String(chunks.length));
}

async function loadBookContent(id) {
  const meta = await window.storage.get(`book_${id}_chunks`);
  const n = parseInt(meta?.value ?? "-1");
  if (n === 0) {
    const raw = await window.storage.get(`book_${id}_data`);
    return raw ? JSON.parse(raw.value) : null;
  }
  if (n > 0) {
    const results = await Promise.all(Array.from({ length: n }, (_, ci) => window.storage.get(`book_${id}_chunk_${ci}`)));
    const pages = []; for (const r of results) if (r) pages.push(...JSON.parse(r.value));
    return pages;
  }
  return null;
}

async function deleteBook(id) {
  const meta = await window.storage.get(`book_${id}_chunks`);
  const n = parseInt(meta?.value ?? "-1");
  if (n === 0) await window.storage.delete(`book_${id}_data`);
  else if (n > 0) await Promise.all(Array.from({ length: n }, (_, ci) => window.storage.delete(`book_${id}_chunk_${ci}`)));
  await window.storage.delete(`book_${id}_chunks`);
  await window.storage.delete(`audio_${id}`);
  state.library = state.library.filter(b => b.id !== id);
  saveLibrary(); renderLibrary();
}

async function resetBookProgress(id) {
  const idx = state.library.findIndex(b => b.id === id);
  if (idx > -1) state.library[idx].currentPage = 0;
  saveLibrary(); renderLibrary();
}

async function handleFileUpload(e) {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  showToast(true, "Processing…");
  let successCount = 0;

  for (const file of files) {
    if (file.name.startsWith(".") || (!/\.(txt|md|epub3?)$/i.test(file.name))) continue;

    try {
      const isEpub = /\.epub3?$/i.test(file.name);
      let bookTitle, bookAuthor="", bookPages, chapters, format, coverDataUrl=null;

      if (isEpub) {
        format = "epub";
        const parsed = await parseEpub(file);
        bookTitle = parsed.title; bookAuthor = parsed.author;
        bookPages = parsed.pages; chapters = parsed.chapters;
        coverDataUrl = parsed.coverDataUrl || null;
      } else {
        format = /\.md$/i.test(file.name) ? "md" : "txt";
        const text = await readFileAsText(file);
        bookTitle = file.name.replace(/\.(txt|md)$/i,"").replace(/[_-]/g," ");
        const blocks = textToBlocks(text);
        bookPages = splitBlocksIntoPages(blocks);
        // Ensure we have at least one page
        if (!bookPages || bookPages.length === 0) {
          bookPages = [[{ type: "para", text: text.trim().slice(0, 2000) || "Empty file." }]];
        }
        chapters = deriveChaptersFromPages(bookPages);
      }

      const id = `book_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
      if (coverDataUrl) {
        await window.storage.set(`cover_${id}`, coverDataUrl);
      }
      await saveBookContent(id, bookPages);
      state.library.push({
        id, title: bookTitle, author: bookAuthor, format,
        totalPages: bookPages.length, currentPage: 0, chapters,
        addedAt: new Date().toISOString(), hasAudio: false,
        coverDataUrl: coverDataUrl || null
      });
      await saveLibrary();
      successCount++;
    } catch (err) {
      console.error("File upload error:", err);
      showToast(false, `Failed: "${file.name}" — ${err.message || "unknown error"}`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  if (successCount > 0) {
    showToast(true, `Added ${successCount} book${successCount > 1 ? "s" : ""}!`);
  }
  renderLibrary();
  hideToast();
  e.target.value = "";
}

async function handleFolderSelect(e) {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;

  // Store folder path info
  const folderName = files[0]?.webkitRelativePath?.split("/")[0] || "Selected folder";
  state.connectedFolder = { name: folderName, fileCount: files.filter(f => /\.(txt|md|epub3?)$/i.test(f.name)).length };
  savePreferences();

  // Process the files
  showToast(true, `Loading ${state.connectedFolder.fileCount} files from "${folderName}"...`);

  for (const file of files) {
    if (file.name.startsWith(".") || (!/\.(txt|md|epub3?)$/i.test(file.name))) continue;
    const alreadyAdded = state.library.some(b => b.title === file.name.replace(/\.(txt|md|epub3?)$/i,"").replace(/[_-]/g," "));
    if (alreadyAdded) continue;

    try {
      const isEpub = /\.epub3?$/i.test(file.name);
      let bookTitle, bookAuthor="", bookPages, chapters, format, coverDataUrl=null;
      if (isEpub) {
        format = "epub";
        const parsed = await parseEpub(file);
        bookTitle = parsed.title; bookAuthor = parsed.author;
        bookPages = parsed.pages; chapters = parsed.chapters;
        coverDataUrl = parsed.coverDataUrl || null;
      } else {
        format = /\.md$/i.test(file.name) ? "md" : "txt";
        const text = await readFileAsText(file);
        bookTitle = file.name.replace(/\.(txt|md)$/i,"").replace(/[_-]/g," ");
        bookPages = splitBlocksIntoPages(textToBlocks(text));
        chapters = deriveChaptersFromPages(bookPages);
      }
      const id = `book_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
      if (coverDataUrl) await window.storage.set(`cover_${id}`, coverDataUrl);
      await saveBookContent(id, bookPages);
      state.library.push({ id, title: bookTitle, author: bookAuthor, format, totalPages: bookPages.length, currentPage: 0, chapters, addedAt: new Date().toISOString(), hasAudio: false, coverDataUrl: coverDataUrl || null });
      await saveLibrary();
    } catch(err) { console.error(err); }
  }
  renderLibrary();
  hideToast();
  // Refresh settings if open
  const body = document.getElementById("modal-body");
  if (body && document.getElementById("settings-modal") && !document.getElementById("settings-modal").classList.contains("hidden")) {
    switchModalTab("library");
  }
  e.target.value = "";
}

async function handleAudioUpload(e) {
  const file = e.target.files[0]; if (!file || !state.activeBook) return;
  const url = await readFileAsDataURL(file);
  await window.storage.set(`audio_${state.activeBook.id}`, url);
  state.audioSrc = url;

  const idx = state.library.findIndex(b => b.id === state.activeBook.id);
  if (idx > -1) { state.library[idx].hasAudio = true; saveLibrary(); }
  state.activeBook.hasAudio = true;

  document.getElementById("audio-player").src = url;
  updateAudioBtn();
  e.target.value = "";
}

function updateAudioBtn() {
  const btn = document.getElementById("btn-toggle-audio");
  if (state.audioSrc) {
    btn.classList.remove("hidden");
    btn.classList.toggle("playing", state.isPlaying);
    btn.title = state.isPlaying ? "Pause audiobook" : "Play audiobook";
  } else {
    btn.classList.add("hidden");
  }
}

function toggleAudio() {
  const player = document.getElementById("audio-player");
  if (!player.src) return;
  if (state.isPlaying) { player.pause(); state.isPlaying = false; }
  else { player.play(); state.isPlaying = true; }
  updateAudioBtn();
}

// ============================================================================
// MODALS & TOASTS
// ============================================================================
function openModal(id) {
  document.getElementById(id).classList.remove("hidden");
  if (id === "settings-modal") switchModalTab("theme");
}

function closeModal(id) { document.getElementById(id).classList.add("hidden"); }

function showToast(isLoading, text) {
  const t = document.getElementById("upload-toast");
  t.classList.remove("hidden", "error");
  if (!isLoading) t.classList.add("error");
  document.getElementById("upload-spinner").style.display = isLoading ? "block" : "none";
  document.getElementById("upload-toast-text").textContent = text;
}
function hideToast() { setTimeout(() => document.getElementById("upload-toast").classList.add("hidden"), 800); }

function switchModalTab(tabId) {
  document.querySelectorAll(".tab").forEach(t => {
    if (t.dataset.tab === tabId) t.classList.add("active"); else t.classList.remove("active");
  });
  const body = document.getElementById("modal-body");

  if (tabId === "theme") {
    const all = { ...BUILT_IN_THEMES, ...state.customThemes };
    body.innerHTML = `
      <div class="section-label">THEME</div>
      <div class="radio-list">
        ${Object.keys(all).map(k => `
          <label class="radio-item ${state.themeKey === k ? "active" : ""}">
            <input type="radio" name="theme" value="${k}" ${state.themeKey === k ? "checked" : ""}>
            <div style="display:flex; gap:4px;">
              <div class="swatch" style="background:${all[k].bg}"></div>
              <div class="swatch" style="background:${all[k].surface}"></div>
              <div class="swatch" style="background:${all[k].accent||"#888"}"></div>
            </div>
            <span style="font-size:13px; font-weight:500; color:var(--text); flex:1;">${all[k].name}</span>
            ${k.startsWith("custom_") ? "<span style=\"font-size:10px; color:var(--textDim)\">Custom</span>" : ""}
          </label>
        `).join("")}
      </div>
      <div class="theme-import-box">
        <div style="font-size:12px; color:var(--textMuted); margin-bottom:8px;">Import custom theme <strong>.json</strong></div>
        <button id="btn-import-theme" class="btn secondary">Import theme (.json)</button>
      </div>
    `;

    body.querySelectorAll("input[name=\"theme\"]").forEach(rad => {
      rad.onchange = (e) => {
        state.themeKey = e.target.value;
        savePreferences();
        applyTheme(state.themeKey); switchModalTab("theme");
      };
    });
    body.querySelector("#btn-import-theme").onclick = () => document.getElementById("theme-input").click();

    document.getElementById("theme-input").onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return;
      try {
        const p = JSON.parse(await readFileAsText(file));
        if (p.name && p.bg && p.text) {
          const k = `custom_${Date.now()}`;
          state.customThemes[k] = p; state.themeKey = k;
          savePreferences();
          applyTheme(k); switchModalTab("theme");
        }
      } catch (err) { alert("Invalid theme file"); }
      e.target.value = "";
    };

  } else if (tabId === "library") {
    const folderHtml = state.connectedFolder
      ? `<div class="folder-connected">
           <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M1 4a1 1 0 0 1 1-1h4l1 2h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
           <span class="folder-path">${state.connectedFolder.name} (${state.connectedFolder.fileCount} files)</span>
           <button style="background:none;border:none;color:var(--textDim);cursor:pointer;font-size:12px;padding:2px 4px;" title="Open folder" id="btn-open-folder">↗</button>
           <button style="background:none;border:none;color:var(--textDim);cursor:pointer;font-size:12px;padding:2px 4px;" title="Disconnect" id="btn-disconnect-folder">✕</button>
         </div>`
      : "";

    body.innerHTML = `
      <div class="section-label">DISCOVER BOOKS</div>
      <a href="https://www.gutenberg.org" target="_blank" class="gutenberg-btn">
        <span class="gutenberg-btn-icon">📚</span>
        <div class="gutenberg-btn-text">
          <div class="title">Project Gutenberg</div>
          <div class="sub">Free public domain ebooks — 70,000+ titles</div>
        </div>
        <svg class="gutenberg-btn-arrow" width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7h8M8 4l3 3-3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </a>

      <div class="section-label" style="margin-top:18px;">LIBRARY DATA</div>
      <p style="font-size:13px; color:var(--textMuted); margin-bottom:14px; line-height:1.6;">Export your library as <strong>biblio-library.json</strong> to back it up.</p>
      <div style="display:flex; gap:10px; margin-bottom:18px;">
        <button id="btn-export-lib" class="btn secondary" style="flex:1; justify-content:center;">↓ Export</button>
        <button id="btn-import-lib" class="btn primary" style="flex:1; justify-content:center;">↑ Import</button>
      </div>

      <div style="display:flex; align-items:center; gap:8px; margin-top:18px; margin-bottom:8px;">
        <div class="section-label" style="margin:0;">CONNECTED FOLDERS</div>
        <button id="btn-reload-folder" title="Reload folder & import new books" style="background:none;border:1px solid var(--border);border-radius:5px;color:var(--textMuted);cursor:pointer;padding:3px 6px;font-size:12px;display:flex;align-items:center;transition:all 0.15s;" onmouseover="this.style.borderColor='var(--accent)';this.style.color='var(--accent)'" onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--textMuted)'">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 8a5 5 0 1 1 1 3.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><polyline points="1,5 3,8 6,6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
      ${folderHtml}
      <div style="display:flex; gap:10px; margin-top:8px;">
        <button id="btn-settings-add-folder" class="btn primary" style="flex:1; justify-content:center;">⊞ Connect Folder</button>
        <button id="btn-settings-add-book" class="btn secondary" style="flex:1; justify-content:center;">+ Add Books</button>
      </div>
    `;

    body.querySelector("#btn-export-lib").onclick = () => {
      const blob = new Blob([JSON.stringify({ _readme: "Biblio Library", books: state.library }, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      Object.assign(document.createElement("a"), { href: url, download: "biblio-library.json" }).click();
      URL.revokeObjectURL(url);
    };
    body.querySelector("#btn-import-lib").onclick = () => document.getElementById("lib-import-input").click();
    body.querySelector("#btn-settings-add-book").onclick = () => document.getElementById("file-input").click();
    body.querySelector("#btn-settings-add-folder").onclick = () => document.getElementById("folder-input").click();
    body.querySelector("#btn-reload-folder")?.addEventListener("click", () => {
      if (state.connectedFolder) {
        // Re-trigger folder picker to reload
        document.getElementById("folder-input").click();
      } else {
        document.getElementById("folder-input").click();
      }
    });
    body.querySelector("#btn-open-folder")?.addEventListener("click", () => {
      // Web can't directly open a folder in file explorer, but we can show the folder name
      // and offer to re-browse it
      if (state.connectedFolder) {
        alert(`Folder: "${state.connectedFolder.name}"\n\nBrowsers cannot open local folders directly for security reasons. Use "Connect Folder" to re-browse it and import any new books.`);
      }
    });
    body.querySelector("#btn-disconnect-folder")?.addEventListener("click", () => {
      state.connectedFolder = null; savePreferences(); switchModalTab("library");
    });

    document.getElementById("lib-import-input").onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return;
      try {
        const d = JSON.parse(await readFileAsText(file));
        if (Array.isArray(d.books)) {
          const ids = new Set(state.library.map((b) => b.id));
          state.library.push(...d.books.filter((b) => !ids.has(b.id)));
          saveLibrary(); renderLibrary();
        }
      } catch (err) { alert("Invalid library file"); }
      e.target.value = "";
    };

  } else if (tabId === "accessibility") {
    body.innerHTML = `
      <p style="font-size:12px; color:var(--textMuted); margin-bottom:16px; line-height:1.6;">These settings apply in the reader view and help improve reading comfort.</p>
      <div class="accessibility-row">
        <div>
          <div class="accessibility-label">Highlight words on hover</div>
          <div class="accessibility-sub">Highlights individual words when you hover over them with your mouse.</div>
        </div>
        <div id="acc-hl-toggle" class="toggle-track ${state.highlightWords?"on":"off"}"><div class="toggle-thumb"></div></div>
      </div>
      <div class="accessibility-row">
        <div>
          <div class="accessibility-label">Underline current line</div>
          <div class="accessibility-sub">Underlines the paragraph you're hovering over to help focus your reading.</div>
        </div>
        <div id="acc-ul-toggle" class="toggle-track ${state.underlineLine?"on":"off"}"><div class="toggle-thumb"></div></div>
      </div>
    `;
    body.querySelector("#acc-hl-toggle").onclick = () => {
      state.highlightWords = !state.highlightWords;
      savePreferences();
      switchModalTab("accessibility");
      if (state.view === "reader") { applyAccessibilityClasses(); renderPage(); }
    };
    body.querySelector("#acc-ul-toggle").onclick = () => {
      state.underlineLine = !state.underlineLine;
      savePreferences();
      switchModalTab("accessibility");
      if (state.view === "reader") { applyAccessibilityClasses(); renderPage(); }
    };
  } else if (tabId === "ai") {
    const ollamaUrl = state.ollamaUrl || "";
    const ollamaModel = state.ollamaModel || "";
    body.innerHTML = `
      <div class="section-label">AI ASSISTANT</div>
      <p style="font-size:12px; color:var(--textMuted); margin-bottom:16px; line-height:1.6;">
        Connect a local Ollama instance for text summarization. If no Ollama server is configured, a free AI summarization API will be used as a fallback.
      </p>
      <label style="display:block; margin-bottom:14px; font-size:12px;">
        <div style="margin-bottom:5px; font-weight:600; color:var(--text);">Ollama Server URL</div>
        <input id="ollama-url-input" type="text" placeholder="http://localhost:11434" value="${ollamaUrl}"
          style="width:100%; background:var(--bg); border:1px solid var(--border); color:var(--text); border-radius:6px; padding:8px 10px; font-size:12px; outline:none; font-family:inherit;">
        <div style="font-size:11px; color:var(--textDim); margin-top:4px;">Leave blank to use free summarization API</div>
      </label>
      <label style="display:block; margin-bottom:14px; font-size:12px;">
        <div style="margin-bottom:5px; font-weight:600; color:var(--text);">Model Name</div>
        <input id="ollama-model-input" type="text" placeholder="llama3, mistral, phi3..." value="${ollamaModel}"
          style="width:100%; background:var(--bg); border:1px solid var(--border); color:var(--text); border-radius:6px; padding:8px 10px; font-size:12px; outline:none; font-family:inherit;">
        <div style="font-size:11px; color:var(--textDim); margin-top:4px;">The model to use for summarization</div>
      </label>
      <div style="display:flex; gap:10px; margin-top:6px;">
        <button id="btn-save-ai" class="btn primary" style="flex:1; justify-content:center;">Save Settings</button>
        <button id="btn-test-ai" class="btn secondary" style="flex:1; justify-content:center;">Test Connection</button>
      </div>
      <div id="ai-test-result" style="margin-top:12px; font-size:12px; color:var(--textDim); min-height:20px;"></div>
      <div style="margin-top:20px; padding-top:16px; border-top:1px solid var(--borderSubtle);">
        <div class="section-label">CURRENT AI SOURCE</div>
        <div style="font-size:12px; color:var(--textMuted); padding:10px 12px; background:var(--surfaceAlt); border-radius:7px; border:1px solid var(--border);">
          ${ollamaUrl ? `✦ Ollama at <strong style="color:var(--accent);">${ollamaUrl}</strong>${ollamaModel ? ` using <strong>${ollamaModel}</strong>` : ""}` : "✦ Free AI summarization API (default)"}
        </div>
      </div>
    `;
    body.querySelector("#btn-save-ai").onclick = () => {
      state.ollamaUrl = body.querySelector("#ollama-url-input").value.trim().replace(/\/$/, "");
      state.ollamaModel = body.querySelector("#ollama-model-input").value.trim();
      savePreferences();
      switchModalTab("ai");
    };
    body.querySelector("#btn-test-ai").onclick = async () => {
      const resultEl = body.querySelector("#ai-test-result");
      const url = body.querySelector("#ollama-url-input").value.trim().replace(/\/$/, "");
      const model = body.querySelector("#ollama-model-input").value.trim() || "llama3";
      if (!url) { resultEl.textContent = "⚠ Enter an Ollama URL to test."; resultEl.style.color = "var(--textDim)"; return; }
      resultEl.textContent = "Testing connection…"; resultEl.style.color = "var(--textDim)";
      try {
        const r = await fetch(`${url}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, prompt: "Say: OK", stream: false })
        });
        if (r.ok) { resultEl.textContent = "✓ Connected successfully!"; resultEl.style.color = "#3fb950"; }
        else { resultEl.textContent = `✗ Server returned ${r.status}`; resultEl.style.color = "#f85149"; }
      } catch (err) {
        resultEl.textContent = `✗ Could not connect: ${err.message}`; resultEl.style.color = "#f85149";
      }
    };
  }
}

// ============================================================================
// PROFILE
// ============================================================================
function openProfile() {
  const modal = document.getElementById("profile-modal");
  modal.classList.remove("hidden");
  renderProfile();
}

function renderProfile() {
  const body = document.getElementById("profile-body");
  const streak = getCurrentStreak();
  const totalMinutes = Object.values(state.readingLog).reduce((a, b) => a + b, 0);
  const avgDaily = Object.keys(state.readingLog).length > 0
    ? totalMinutes / Object.keys(state.readingLog).length : 0;
  const totalBooks = state.library.length;
  const booksFinished = state.library.filter(b => b.currentPage >= b.totalPages - 2).length;

  // Build heatmap (last 12 weeks = 84 days)
  const heatmapDays = [];
  for (let i = 83; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const mins = state.readingLog[key] || 0;
    const level = mins === 0 ? 0 : mins < 10 ? 1 : mins < 30 ? 2 : mins < 60 ? 3 : 4;
    heatmapDays.push({ key, mins, level });
  }

  // Top books by pages read
  const bookStats = state.library.map(b => ({
    ...b,
    pagesRead: b.currentPage || 0,
  })).sort((a, b) => b.pagesRead - a.pagesRead).slice(0, 5);
  const maxPages = bookStats[0]?.pagesRead || 1;

  body.innerHTML = `
    <div class="profile-stats-grid">
      <div class="profile-stat-card">
        <div class="profile-stat-value">${streak}</div>
        <div class="profile-stat-label">Day Streak</div>
      </div>
      <div class="profile-stat-card">
        <div class="profile-stat-value">${Math.round(avgDaily)}</div>
        <div class="profile-stat-label">Avg Min / Day</div>
      </div>
      <div class="profile-stat-card">
        <div class="profile-stat-value">${totalBooks}</div>
        <div class="profile-stat-label">Books</div>
      </div>
      <div class="profile-stat-card">
        <div class="profile-stat-value">${booksFinished}</div>
        <div class="profile-stat-label">Finished</div>
      </div>
      <div class="profile-stat-card">
        <div class="profile-stat-value">${Math.round(totalMinutes)}</div>
        <div class="profile-stat-label">Total Min Read</div>
      </div>
      <div class="profile-stat-card">
        <div class="profile-stat-value">${Math.round(totalMinutes / 60 * 10) / 10}</div>
        <div class="profile-stat-label">Hours Read</div>
      </div>
    </div>

    <div class="profile-section-title">Reading Activity — Last 12 Weeks</div>
    <div class="heatmap-grid">
      ${heatmapDays.map(d => `<div class="heatmap-cell" data-level="${d.level}" title="${d.key}: ${Math.round(d.mins)} min"></div>`).join("")}
    </div>
    <div class="heatmap-legend">
      <span>Less</span>
      <div class="heatmap-legend-cell" style="background:var(--surfaceAlt);border:1px solid var(--borderSubtle)"></div>
      <div class="heatmap-legend-cell" style="background:rgba(56,139,253,0.25)"></div>
      <div class="heatmap-legend-cell" style="background:rgba(56,139,253,0.5)"></div>
      <div class="heatmap-legend-cell" style="background:rgba(56,139,253,0.75)"></div>
      <div class="heatmap-legend-cell" style="background:var(--accent)"></div>
      <span>More</span>
    </div>

    <div class="profile-section-title" style="margin-top:24px;">Most Read Books</div>
    <div class="top-books-list">
      ${bookStats.length === 0 ? `<div style="color:var(--textDim);font-size:13px;">No reading data yet.</div>` :
        bookStats.map((b, i) => {
          const [c1, c2] = generateCoverColor(b.title);
          const coverHtml = b.coverDataUrl
            ? `<img src="${b.coverDataUrl}" alt="">`
            : `<div style="width:100%;height:100%;background:linear-gradient(135deg,${c1},${c2});"></div>`;
          // Use actual reading progress as percentage (not relative to max)
          const progressPct = b.totalPages > 1 ? Math.round((b.pagesRead / (b.totalPages - 1)) * 100) : (b.pagesRead > 0 ? 100 : 0);
          const timesRead = b.pagesRead >= b.totalPages - 2 ? Math.max(1, b.timesRead || 1) : (b.timesRead || 0);
          return `<div class="top-book-row">
            <span class="top-book-rank">${i+1}</span>
            <div class="top-book-cover">${coverHtml}</div>
            <div class="top-book-info">
              <div class="top-book-title">${b.title}</div>
              <div class="top-book-pgs">${b.pagesRead} / ${b.totalPages} pages${timesRead > 0 ? ` · ${timesRead}× read` : ""}</div>
            </div>
            <div class="top-book-bar-wrap" title="${progressPct}% complete">
              <div class="top-book-bar-track"><div class="top-book-bar-fill" style="width:${progressPct}%"></div></div>
              <div style="font-size:9px;color:var(--textDim);text-align:right;margin-top:2px;">${progressPct}%</div>
            </div>
          </div>`;
        }).join("")}
    </div>
  `;
}

function openNotesViewer() {
  if (!state.activeBook) return;
  // Toggle - if already open close it
  if (_notePanelEl && document.body.contains(_notePanelEl)) { removeNotePanel(); return; }
  const notes = (state.notes && state.notes[state.activeBook.id]) || [];
  const panel = document.createElement("div");
  panel.className = "notes-viewer-panel";
  _notePanelEl = panel;

  panel.innerHTML = `
    <div class="note-panel-header">
      <span class="note-panel-title">Notes (${notes.length})</span>
      <button class="note-panel-close">×</button>
    </div>
    <div class="notes-scroll">
      ${notes.length === 0
        ? `<div style="padding:24px 16px;text-align:center;color:var(--textDim);font-size:13px;line-height:1.6;">No notes yet.<br><span style="font-size:11px;">Highlight text in the reader to add notes.</span></div>`
        : notes.slice().reverse().map(n => `
          <div class="note-item">
            <div class="note-item-quote">"${n.quote.slice(0,80)}${n.quote.length>80?"…":""}"</div>
            <div class="note-item-text">${n.text}</div>
            <div class="note-item-meta">
              <span>${new Date(n.createdAt).toLocaleDateString()}</span>
              <div style="display:flex;gap:8px;align-items:center;">
                <button class="note-item-jump" data-page="${n.page}" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:11px;padding:0;">Jump to page ${n.page + 1}</button>
                <button class="note-item-delete" data-id="${n.id}">Delete</button>
              </div>
            </div>
          </div>
        `).join("")}
    </div>
  `;
  document.body.appendChild(panel);
  panel.querySelector(".note-panel-close").onclick = () => removeNotePanel();
  panel.querySelectorAll(".note-item-delete").forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.id;
      if (state.notes[state.activeBook.id]) {
        state.notes[state.activeBook.id] = state.notes[state.activeBook.id].filter(n => n.id !== id);
        window.storage.set("reader_notes", JSON.stringify(state.notes));
      }
      openNotesViewer();
    };
  });
  panel.querySelectorAll(".note-item-jump").forEach(btn => {
    btn.onclick = () => {
      const page = parseInt(btn.dataset.page, 10);
      if (!isNaN(page) && page >= 0 && page < state.pages.length) {
        state.currentPage = page;
        updateProgress(page);
        removeNotePanel();
      }
    };
  });
}

// ============================================================================
// CLICK OUTSIDE CLOSERS
// ============================================================================
document.addEventListener("mousedown", (e) => {
  const panel = document.getElementById("reader-settings-panel");
  const drop = document.getElementById("chapter-dropdown");
  const searchDrop = document.getElementById("search-results-dropdown");
  const ctxMenus = document.querySelectorAll(".context-menu");

  if (_wordPopupEl && !_wordPopupEl.contains(e.target) && !e.target.classList.contains("word")) removeWordPopup();
  if (_selToolbarEl && !_selToolbarEl.contains(e.target)) removeSelToolbar();
  if (_summaryPopupEl && !_summaryPopupEl.contains(e.target)) removeSummaryPopup();
  if (_notePanelEl && !_notePanelEl.contains(e.target) && e.target.id !== "btn-reader-notes") removeNotePanel();
  if (panel && !panel.classList.contains("hidden") && !panel.contains(e.target) && e.target.id !== "btn-reader-settings") panel.classList.add("hidden");
  if (drop && !drop.classList.contains("hidden") && !drop.contains(e.target) && !document.getElementById("btn-chapter-drop")?.contains(e.target)) drop.classList.add("hidden");
  if (searchDrop && !searchDrop.classList.contains("hidden") && !searchDrop.contains(e.target) && !document.getElementById("library-search")?.contains(e.target)) closeSearchDropdown();
  ctxMenus.forEach(m => { if (!m.classList.contains("hidden") && !m.contains(e.target)) m.classList.add("hidden"); });
});

window.onload = initApp;