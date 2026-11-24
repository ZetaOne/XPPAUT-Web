// Editor themes: one palette each, turned into the page's colours (CSS
// variables) and into Monaco's and CodeMirror's themes.

export interface Palette {
  id: string
  name: string
  dark: boolean
  bg: string // editor background
  fg: string
  side: string // explorer, tab strip
  bar: string // title and status bars
  line: string // borders
  accent: string
  sel: string // selection
  comment: string
  keyword: string
  option: string
  number: string
  string: string
  func: string
  variable: string
  deriv: string
  command: string
  error: string
  warning: string
}

export const THEMES: Palette[] = [
  { id: 'dark-plus', name: 'Dark+ (VS Code)', dark: true, bg: '#1e1e1e', fg: '#d4d4d4', side: '#252526', bar: '#333333', line: '#3c3c3c', accent: '#0e7ad3', sel: '#264f78', comment: '#6a9955', keyword: '#569cd6', option: '#9cdcfe', number: '#b5cea8', string: '#ce9178', func: '#dcdcaa', variable: '#9cdcfe', deriv: '#4ec9b0', command: '#c586c0', error: '#f14c4c', warning: '#cca700' },
  { id: 'light-plus', name: 'Light+ (VS Code)', dark: false, bg: '#ffffff', fg: '#1f1f1f', side: '#f3f3f3', bar: '#dddddd', line: '#d4d4d4', accent: '#005fb8', sel: '#add6ff', comment: '#008000', keyword: '#0000ff', option: '#001080', number: '#098658', string: '#a31515', func: '#795e26', variable: '#001080', deriv: '#267f99', command: '#af00db', error: '#e51400', warning: '#bf8803' },
  { id: 'one-dark', name: 'One Dark', dark: true, bg: '#282c34', fg: '#abb2bf', side: '#21252b', bar: '#21252b', line: '#181a1f', accent: '#528bff', sel: '#3e4451', comment: '#7f848e', keyword: '#c678dd', option: '#e5c07b', number: '#d19a66', string: '#98c379', func: '#61afef', variable: '#e06c75', deriv: '#56b6c2', command: '#c678dd', error: '#e06c75', warning: '#e5c07b' },
  { id: 'monokai', name: 'Monokai', dark: true, bg: '#272822', fg: '#f8f8f2', side: '#1e1f1c', bar: '#1e1f1c', line: '#3e3d32', accent: '#a6e22e', sel: '#49483e', comment: '#75715e', keyword: '#f92672', option: '#fd971f', number: '#ae81ff', string: '#e6db74', func: '#66d9ef', variable: '#f8f8f2', deriv: '#a6e22e', command: '#f92672', error: '#f92672', warning: '#fd971f' },
  { id: 'dracula', name: 'Dracula', dark: true, bg: '#282a36', fg: '#f8f8f2', side: '#21222c', bar: '#191a21', line: '#44475a', accent: '#bd93f9', sel: '#44475a', comment: '#6272a4', keyword: '#ff79c6', option: '#ffb86c', number: '#bd93f9', string: '#f1fa8c', func: '#50fa7b', variable: '#8be9fd', deriv: '#50fa7b', command: '#ff79c6', error: '#ff5555', warning: '#ffb86c' },
  { id: 'nord', name: 'Nord', dark: true, bg: '#2e3440', fg: '#d8dee9', side: '#3b4252', bar: '#3b4252', line: '#434c5e', accent: '#88c0d0', sel: '#434c5e', comment: '#616e88', keyword: '#81a1c1', option: '#8fbcbb', number: '#b48ead', string: '#a3be8c', func: '#88c0d0', variable: '#d8dee9', deriv: '#8fbcbb', command: '#81a1c1', error: '#bf616a', warning: '#ebcb8b' },
  { id: 'solarized-dark', name: 'Solarized Dark', dark: true, bg: '#002b36', fg: '#93a1a1', side: '#073642', bar: '#073642', line: '#0a4b5c', accent: '#268bd2', sel: '#0d4a5a', comment: '#586e75', keyword: '#859900', option: '#b58900', number: '#d33682', string: '#2aa198', func: '#268bd2', variable: '#93a1a1', deriv: '#cb4b16', command: '#6c71c4', error: '#dc322f', warning: '#b58900' },
  { id: 'solarized-light', name: 'Solarized Light', dark: false, bg: '#fdf6e3', fg: '#586e75', side: '#eee8d5', bar: '#eee8d5', line: '#ddd6c1', accent: '#268bd2', sel: '#e3dcc8', comment: '#93a1a1', keyword: '#859900', option: '#b58900', number: '#d33682', string: '#2aa198', func: '#268bd2', variable: '#586e75', deriv: '#cb4b16', command: '#6c71c4', error: '#dc322f', warning: '#b58900' },
  { id: 'github-light', name: 'GitHub Light', dark: false, bg: '#ffffff', fg: '#24292f', side: '#f6f8fa', bar: '#eaeef2', line: '#d0d7de', accent: '#0969da', sel: '#b6e3ff', comment: '#6e7781', keyword: '#cf222e', option: '#953800', number: '#0550ae', string: '#0a3069', func: '#8250df', variable: '#24292f', deriv: '#116329', command: '#cf222e', error: '#cf222e', warning: '#9a6700' },
  { id: 'high-contrast', name: 'High Contrast', dark: true, bg: '#000000', fg: '#ffffff', side: '#000000', bar: '#000000', line: '#6fc3df', accent: '#f38518', sel: '#264f78', comment: '#7ca668', keyword: '#569cd6', option: '#9cdcfe', number: '#b5cea8', string: '#ce9178', func: '#dcdcaa', variable: '#9cdcfe', deriv: '#4ec9b0', command: '#c586c0', error: '#ff3333', warning: '#ffd700' },
]

/** the site's theme (Settings there) mapped to an editor theme */
export function followSite(): Palette {
  let id = 'system'
  try {
    id = localStorage.getItem('xpp-theme') || 'system'
  } catch {
    /* blocked */
  }
  const map: Record<string, string> = {
    light: 'light-plus', dark: 'dark-plus', midnight: 'dark-plus', 'solarized-light': 'solarized-light', 'solarized-dark': 'solarized-dark',
    nord: 'nord', dracula: 'dracula', sepia: 'solarized-light', contrast: 'high-contrast', funky1: 'dracula', funky2: 'one-dark', funky3: 'monokai',
  }
  const dark = matchMedia('(prefers-color-scheme: dark)').matches
  const want = map[id] ?? (dark ? 'dark-plus' : 'light-plus')
  return THEMES.find((t) => t.id === want)!
}

export function applyUiColours(p: Palette) {
  const r = document.documentElement.style
  r.setProperty('--ed-bg', p.bg)
  r.setProperty('--ed-fg', p.fg)
  r.setProperty('--ed-side', p.side)
  r.setProperty('--ed-bar', p.bar)
  r.setProperty('--ed-line', p.line)
  r.setProperty('--ed-accent', p.accent)
  r.setProperty('--ed-sel', p.sel)
  r.setProperty('--ed-error', p.error)
  r.setProperty('--ed-warning', p.warning)
  r.setProperty('--ed-muted', p.comment)
  document.documentElement.style.colorScheme = p.dark ? 'dark' : 'light'
}
