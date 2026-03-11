// All built-in themes. Keys must match what's stored in preferences.

export const BUILT_IN_THEMES = {
  dark: {
    name: 'Dark',
    bg: '#0d1117', surface: '#161b22', surfaceAlt: '#1c2128',
    border: '#30363d', borderSubtle: '#21262d',
    text: '#e6edf3', textDim: '#8b949e',
    accent: '#388bfd', accentHover: '#58a6ff',
    readerBg: '#0d1117', readerCard: '#161b22', readerText: '#e6edf3',
    headerBg: '#161b22', hover: 'rgba(255,255,255,0.06)',
  },
  light: {
    name: 'Light',
    bg: '#f6f8fa', surface: '#ffffff', surfaceAlt: '#f0f2f4',
    border: '#d0d7de', borderSubtle: '#e8ebed',
    text: '#1f2328', textDim: '#636c76',
    accent: '#0969da', accentHover: '#0860c7',
    readerBg: '#f6f8fa', readerCard: '#ffffff', readerText: '#1f2328',
    headerBg: '#ffffff', hover: 'rgba(0,0,0,0.06)',
  },
  sepia: {
    name: 'Sepia',
    bg: '#f4efe6', surface: '#faf6ef', surfaceAlt: '#ede8df',
    border: '#c8b89a', borderSubtle: '#ddd4c4',
    text: '#3b2f20', textDim: '#7a6652',
    accent: '#8b5e3c', accentHover: '#a0714e',
    readerBg: '#f4efe6', readerCard: '#faf6ef', readerText: '#3b2f20',
    headerBg: '#faf6ef', hover: 'rgba(0,0,0,0.05)',
  },
  midnight: {
    name: 'Midnight',
    bg: '#05050a', surface: '#0e0e18', surfaceAlt: '#141422',
    border: '#252538', borderSubtle: '#1a1a2c',
    text: '#d4d4e8', textDim: '#6666aa',
    accent: '#7c6af7', accentHover: '#9585ff',
    readerBg: '#05050a', readerCard: '#0e0e18', readerText: '#d4d4e8',
    headerBg: '#0e0e18', hover: 'rgba(255,255,255,0.05)',
  },
  forest: {
    name: 'Forest',
    bg: '#0f1a0f', surface: '#162016', surfaceAlt: '#1c2a1c',
    border: '#2d4a2d', borderSubtle: '#1f361f',
    text: '#c8e6c8', textDim: '#6a9a6a',
    accent: '#4caf50', accentHover: '#66bb6a',
    readerBg: '#0f1a0f', readerCard: '#162016', readerText: '#c8e6c8',
    headerBg: '#162016', hover: 'rgba(255,255,255,0.05)',
  },
}

export function applyTheme(themeKey, customThemes = {}) {
  const all = { ...BUILT_IN_THEMES, ...customThemes }
  const theme = all[themeKey] || BUILT_IN_THEMES.dark
  const root = document.documentElement
  Object.entries(theme).forEach(([key, val]) => {
    if (typeof val === 'string') root.style.setProperty(`--${key}`, val)
  })
}