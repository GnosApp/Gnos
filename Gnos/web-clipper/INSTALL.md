# Gnos Clipper — Installation Guide

## 1. Generate Icons (one-time setup)

Open `generate-icons.html` in any browser. It will download four PNG files.
Save them inside the `icons/` folder:

```
web-clipper/
  icons/
    icon16.png
    icon32.png
    icon48.png
    icon128.png
```

---

## 2. Chrome / Edge / Brave

1. Go to `chrome://extensions`
2. Enable **Developer mode** (toggle, top-right)
3. Click **Load unpacked**
4. Select the `web-clipper/` folder
5. The Gnos Clipper icon appears in your toolbar

---

## 3. Firefox

1. Go to `about:debugging`
2. Click **This Firefox** → **Load Temporary Add-on**
3. Select `web-clipper/manifest.json`

> Firefox requires a `browser_specific_settings` key for a permanent install.
> Add this to `manifest.json` for permanent installation via AMO (addons.mozilla.org):
> ```json
> "browser_specific_settings": {
>   "gecko": { "id": "gnos-clipper@gnos.app", "strict_min_version": "109.0" }
> }
> ```

---

## 4. Safari (Xcode required)

Safari only loads extensions that are wrapped in a native macOS app.
Here is the step-by-step process:

### Step 1 — Install Xcode

Download Xcode from the Mac App Store (free, ~7 GB).
Also install the command-line tools:

```bash
xcode-select --install
```

### Step 2 — Convert the extension

Apple provides a command-line tool that converts a standard web extension
into an Xcode project automatically:

```bash
xcrun safari-web-extension-converter \
  '/Users/ethanhooley/Documents/Personal Projects/Gnos/web-clipper' \
  --project-location ~/Desktop \
  --app-name "Gnos Clipper" \
  --bundle-identifier com.yourname.gnos-clipper \
  --swift
```

Replace `/path/to/web-clipper` with the actual absolute path, e.g.:
`"/Users/ethanhooley/Documents/Personal Projects/Gnos/web-clipper"`

This creates a new folder on your Desktop called `Gnos Clipper/`
containing a full Xcode project.

### Step 3 — Open and run in Xcode

1. Open the generated `.xcodeproj` file in Xcode
2. Select your Mac as the run target (not a simulator)
3. Press **▶ Run** (or `Cmd+R`)
4. The app will build and launch — a small helper app window appears

### Step 4 — Enable in Safari

1. In Safari, go to **Safari → Settings → Extensions**
2. Check the checkbox next to **Gnos Clipper**
3. Click **Always Allow on Every Website** (or configure per-site)
4. The extension icon appears in the Safari toolbar

### Step 5 (optional) — Allow without developer mode

By default Safari requires you to enable developer mode for unsigned extensions:

1. **Safari → Settings → Advanced** → check **Show Develop menu in menu bar**
2. **Develop → Allow Unsigned Extensions**

This setting resets on Mac restart. For permanent install (no developer mode
needed) you must sign the app with an Apple Developer account ($99/year):

1. In Xcode, go to **Signing & Capabilities**
2. Select your Team (Apple ID)
3. Set the Bundle Identifier to match `--bundle-identifier` above
4. Archive and export as a **Mac App** → upload to the Mac App Store or distribute directly

---

## How to Use

1. Navigate to any webpage in your browser
2. Click the **G** icon in your toolbar
3. Choose a clip mode:
   - **Article** — extracts the main article text (best for blog posts, Wikipedia, docs)
   - **Selection** — clips whatever text you have highlighted on the page
   - **Full Page** — the entire page body as markdown
   - **Link Only** — just the URL and title as a markdown link
4. Edit the title and add comma-separated tags
5. Click **Copy Markdown**
6. Switch to Gnos, open a notebook, and **paste** (`Cmd+V`) anywhere

The content is pasted as clean markdown with a YAML frontmatter header:

```markdown
---
title: My Clipped Article
source: https://example.com/article
date: 2026-03-25
clipped_by: Gnos Clipper
tags: [research, ai]
---

> Article description here

# My Clipped Article

Article body as clean markdown...
```

---

## Notes

- The extension never sends your data anywhere — everything stays local
- Images are linked by their original URL (not downloaded)
- The article extractor is heuristic-based (scores by text density);
  on complex sites use **Selection** mode for precise clipping
- Code blocks, tables, links, and basic formatting are preserved
