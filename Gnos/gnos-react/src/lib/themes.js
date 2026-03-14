// All built-in themes. Keys must match what's stored in preferences.

export const BUILT_IN_THEMES = {
  sepia: {
    name: 'Sepia',
    bg: '#f4efe6', surface: '#faf6ef', surfaceAlt: '#ede8df',
    border: '#c8b89a', borderSubtle: '#ddd4c4',
    text: '#3b2f20', textDim: '#7a6652',
    accent: '#8b5e3c', accentHover: '#a0714e',
    readerBg: '#f4efe6', readerCard: '#faf6ef', readerText: '#3b2f20',
    headerBg: '#faf6ef', hover: 'rgba(0,0,0,0.05)',
  },
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
  cherry: {
    name: 'Cherry',
    bg: '#0e0608', surface: '#170b0d', surfaceAlt: '#200f12',
    border: '#3d1a20', borderSubtle: '#2a1014',
    text: '#f2dde1', textDim: '#9e6d76',
    accent: '#e05c7a', accentHover: '#f07090',
    readerBg: '#0e0608', readerCard: '#170b0d', readerText: '#f2dde1',
    headerBg: '#170b0d', hover: 'rgba(224,92,122,0.08)',
  },
  sunset: {
    name: 'Sunset',
    bg: '#0f0a04', surface: '#1a1008', surfaceAlt: '#241608',
    border: '#4a3010', borderSubtle: '#2e1e08',
    text: '#f5e6c8', textDim: '#a07840',
    accent: '#e8922a', accentHover: '#f0a840',
    readerBg: '#0f0a04', readerCard: '#1a1008', readerText: '#f5e6c8',
    headerBg: '#1a1008', hover: 'rgba(232,146,42,0.08)',
  },
  moss: {
    name: 'Moss',
    bg: '#f2f5ee', surface: '#f8faf5', surfaceAlt: '#e8ede2',
    border: '#b8c9a8', borderSubtle: '#d0ddc6',
    text: '#2a3320', textDim: '#5a7048',
    accent: '#4a7c3f', accentHover: '#3d6934',
    readerBg: '#f2f5ee', readerCard: '#f8faf5', readerText: '#2a3320',
    headerBg: '#f8faf5', hover: 'rgba(74,124,63,0.07)',
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