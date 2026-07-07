import type { GnosPlugin } from 'gnos-plugin-api'

const plugin: GnosPlugin = {
  async onLoad(api) {
    console.log('[my-plugin] loaded, pluginId:', api.pluginId)

    // React to books being opened
    api.on('book:opened', (book) => {
      api.ui.showToast(`Opened: ${book.title}`)
    })

    // Add a toolbar button in the reader
    api.ui.addToolbarButton({
      id: 'my-button',
      icon: '★',
      title: 'My Plugin Action',
      onClick() {
        const book = api.getActiveBook()
        api.ui.showToast(book ? `Active: ${book.title}` : 'No book open')
      },
    })

    // Persist settings with per-plugin storage
    const count = (api.storage.get<number>('launchCount') ?? 0) + 1
    api.storage.set('launchCount', count)
    console.log('[my-plugin] launched', count, 'time(s)')
  },

  onUnload() {
    console.log('[my-plugin] unloaded')
  },
}

export default plugin
