// XPP's font sizes. XPP draws menus and buttons in its "big" font and some
// smaller text (sliders, data browser...) in its "small" font, chosen when it
// starts (-bigfont / -smallfont, like the desktop version). The fonts are the
// classic X bitmap fonts built into web/xlib (scripts/gen-fonts.py).

export interface FontChoice {
  big: string
  small: string
}

/** X font names XPP can use here (web/xlib/fonts_data.c) */
export const FONT_NAMES = [
  '5x7', '5x8', '6x9', '6x10', '6x12', '6x13', '6x13bold', '7x13', '7x13bold', '7x14', '7x14bold',
  '8x13', '8x13bold', '9x15', '9x15bold', '9x18', '9x18bold', '10x20',
]

export const PRESETS: Array<{ id: string; label: string; fonts: FontChoice }> = [
  { id: 'normal', label: 'Normal', fonts: { big: '6x13', small: '6x13' } }, // XPP's defaults (fixed, 6x13)
  { id: 'large', label: 'Large', fonts: { big: '9x15', small: '7x14' } },
  { id: 'xlarge', label: 'Extra large', fonts: { big: '10x20', small: '9x15' } },
]

const KEY = 'xpp-font'

/** "large", "xlarge", "normal", or "BIG,SMALL" (e.g. "9x15bold,7x14") */
export function parseFont(v: string | null | undefined): FontChoice | null {
  if (!v) return null
  const s = v.trim().toLowerCase()
  const alias: Record<string, string> = { big: 'large', larger: 'xlarge', 'extra-large': 'xlarge', extralarge: 'xlarge', xl: 'xlarge', default: 'normal' }
  const p = PRESETS.find((x) => x.id === (alias[s] ?? s))
  if (p) return { ...p.fonts }
  const [big, small] = s.split(/[,;/ ]+/)
  if (FONT_NAMES.includes(big) && FONT_NAMES.includes(small ?? big)) return { big, small: small ?? big }
  return null
}

export function fontKey(f: FontChoice): string {
  const p = PRESETS.find((x) => x.fonts.big === f.big && x.fonts.small === f.small)
  return p ? p.id : `${f.big},${f.small}`
}

function stored(): FontChoice | null {
  try {
    return parseFont(localStorage.getItem(KEY))
  } catch {
    return null
  }
}

export function saveFont(f: FontChoice): void {
  try {
    if (fontKey(f) === 'normal') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, fontKey(f))
  } catch {
    /* private window: for this visit only */
  }
}

/** the fonts for the next start: a link's ?font=… wins over the saved choice */
export function chosenFont(): FontChoice {
  return parseFont(new URLSearchParams(location.search).get('font')) ?? stored() ?? { ...PRESETS[0].fonts }
}

/** XPP command-line arguments for these fonts */
export function fontArgs(f: FontChoice): string[] {
  return fontKey(f) === 'normal' ? [] : ['-bigfont', f.big, '-smallfont', f.small]
}
