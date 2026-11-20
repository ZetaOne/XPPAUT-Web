// Expected next commands for voice: after a command, only a few things make
// sense next (after AUTO: Run, Grab, Parameter...; inside a menu: its items;
// in Grab: next point, grab it...). What is heard is snapped to the closest
// of those by how it sounds ("graph", "grop" -> Grab), and the page shows
// them as suggestions. src/main.ts keeps the state; this file only compares.

/** an option the user may say next: its label, ways to say it, and what to
 *  feed the command matcher (or a key to press inside an open menu) */
export interface FlowOption {
  label: string
  phrases: string[]
}

/** a rough sound key: the consonant skeleton, with common spellings of the
 *  same sound folded together ("graph" grf, "grab" grb) */
export function soundKey(text: string): string {
  let t = ' ' + text.toLowerCase().replace(/[^a-z ]/g, '') + ' '
  const rules: Array<[RegExp, string]> = [
    [/ph/g, 'f'], [/gh(?=[^aeiou]| )/g, ''], [/ck/g, 'k'], [/q/g, 'k'], [/x/g, 'ks'],
    [/c(?=[eiy])/g, 's'], [/c/g, 'k'], [/dg/g, 'j'], [/ wr/g, ' r'], [/ kn/g, ' n'], [/ gn/g, ' n'],
    [/z/g, 's'], [/v/g, 'f'], [/(?<=[a-z])w/g, ''], [/(?<=[a-z])h/g, ''], [/y(?=[^aeiou]| )/g, ''],
  ]
  for (const [re, by] of rules) t = t.replace(re, by)
  return t
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0] + w.slice(1).replace(/[aeiou]/g, '')) // vowels only at the start
    .map((w) => w.replace(/(.)\1+/g, '$1'))
    .join(' ')
}

function lev(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]
    d[0] = i
    for (let j = 1; j <= b.length; j++) {
      const t = d[j]
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = t
    }
  }
  return d[b.length]
}

const pairs = (t: string) => {
  const x = t.replace(/[^a-z0-9]/g, '')
  const out = new Set<string>()
  for (let i = 0; i < x.length - 1; i++) out.add(x.slice(i, i + 2))
  return out
}

/** how alike two phrases sound, 0..1 */
export function soundsLike(a: string, b: string): number {
  const ka = soundKey(a).replace(/ /g, '')
  const kb = soundKey(b).replace(/ /g, '')
  const keyScore = ka && kb ? 1 - lev(ka, kb) / Math.max(ka.length, kb.length) : 0
  const pa = pairs(a)
  const pb = pairs(b)
  let n = 0
  for (const p of pa) if (pb.has(p)) n++
  const textScore = pa.size + pb.size ? (2 * n) / (pa.size + pb.size) : 0
  return 0.65 * keyScore + 0.35 * textScore
}

const FILLER = /\b(?:the|a|an|please|now|um|uh|ok|okay|do|go)\b/g

/** the option that what was heard most sounds like, when it is clearly the
 *  best and good enough */
export function snap<T extends FlowOption>(heard: string[], options: T[], min = 0.55, margin = 0.08): { o: T; score: number } | null {
  const scored: Array<{ o: T; score: number }> = []
  for (const o of options) {
    let best = 0
    for (const h of heard) {
      const said = h.toLowerCase().replace(FILLER, ' ').replace(/\s+/g, ' ').trim()
      if (!said) continue
      for (const p of o.phrases) best = Math.max(best, said === p ? 1 : soundsLike(said, p))
    }
    scored.push({ o, score: best })
  }
  scored.sort((x, y) => y.score - x.score)
  const [first, second] = scored
  if (!first || first.score < min) return null
  if (second && first.score - second.score < margin && first.score < 1) return null
  return first
}
