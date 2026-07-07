# Gnos Plugin Registry

Community plugin directory for [Gnos](https://github.com/GnosApp/Gnos) — the reading and note-taking app.

Plugins listed here appear in the **Plugins → Browse** tab inside the app. Users can install them in one click. No app update required.

---

## Submit a plugin

1. **Build your plugin** using the [plugin template](https://github.com/GnosApp/gnos-plugin-template)
2. **Create a GitHub release** on your repo with these two files as release assets:
   - `manifest.json`
   - `index.js`
3. **Open a pull request** adding your entry to `registry.json`:

```json
{
  "id": "com.yourname.plugin-name",
  "name": "Plugin Name",
  "author": "Your Name",
  "description": "One sentence describing what it does.",
  "repo": "yourname/your-repo",
  "version": "1.0.0",
  "minAppVersion": "0.1.0"
}
```

PRs are reviewed for basic safety. See requirements below.

---

## Requirements

- `id` must be reverse-domain format: `com.yourname.plugin-name`
- `repo` must be a public GitHub repo you own
- Release assets (`manifest.json` + `index.js`) must exist at the `latest` release tag
- Plugin must use the [Gnos Plugin API](https://www.npmjs.com/package/gnos-plugin-api) — no direct DOM manipulation or `eval`
- No network requests unless declared in `permissions` and documented in your README
- No obfuscated code

---

## Plugin development

**Quick start:**

```sh
# Copy the template
git clone https://github.com/GnosApp/gnos-plugin-template my-plugin
cd my-plugin

# Install deps
npm install

# Edit src/index.ts, then build
npm run build   # → index.js

# During development
npm run dev     # watch mode
```

**API overview:**

```ts
import type { GnosPlugin } from 'gnos-plugin-api'

const plugin: GnosPlugin = {
  async onLoad(api) {
    // React to events
    api.on('book:opened', book => {
      api.ui.showToast(`Opened: ${book.title}`)
    })

    // Add toolbar button
    api.ui.addToolbarButton({
      id: 'my-btn',
      icon: '★',
      title: 'My Action',
      onClick() { /* ... */ },
    })

    // Persistent storage
    api.storage.set('key', { value: 42 })
    api.storage.get('key') // → { value: 42 }

    // Call Tauri commands (declared in manifest permissions)
    const result = await api.invoke('my_command', { arg: 'value' })
  },

  onUnload() {
    // clean up
  },
}

export default plugin
```

Full type docs: [gnos-plugin-api on npm](https://www.npmjs.com/package/gnos-plugin-api)

---

## Publishing a new version

1. Bump `version` in your `manifest.json`
2. Build: `npm run build`
3. Create a new GitHub release (tag doesn't matter — Gnos always fetches `latest`)
4. Attach the updated `manifest.json` and `index.js` as release assets
5. Open a PR here updating your `version` field in `registry.json`

Users who already have the plugin installed will see an **Update** button the next time they open the Browse tab.

---

## License

Each plugin is licensed independently by its author. The registry itself is MIT.
