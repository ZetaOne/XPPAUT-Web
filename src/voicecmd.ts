// Spoken commands -> actions (Android app; pure, also run by Node in
// scripts/voice-test.mjs). What a recognizer heard (several guesses, best
// first) is matched against the commands of the current context: XPP's main
// window, the AUTO window, or the .ode editor. Numbers can be spoken
// ("two point five", "minus three", "twenty three") or come as digits; the
// model's names can be said as words or spelled ("g k" for gk).

import { METHOD_VALUES, OPTIONS, formatValue } from './odeopts.ts'

export type Context = 'xpp' | 'auto' | 'editor'

export type Action =
  | { kind: 'keys'; keys: string[]; to: 'main' | 'auto' | 'active' }
  /** set a parameter or initial value */
  | { kind: 'set'; name: string; value: number }
  /** a Numerics entry with a value: u, key, value, Enter, Esc */
  | { kind: 'numeric'; key: string; value: number; label: string }
  /** a Numerics choice from a menu: u, key, choice, Esc */
  | { kind: 'menu'; keys: string[] }
  /** the page itself: zoom, keyboard, sliders, help... */
  | { kind: 'ui'; id: string }
  /** the .ode editor or XPP's prompt line: cursor and editing */
  | { kind: 'edit'; op: EditOp; n?: number; text?: string }
  /** the editor: @ options in the file ([key, value written]) */
  | { kind: 'option'; set: Array<[string, string]> }
  /** the editor: a parameter's or initial value's number in the file */
  | { kind: 'value'; name: string; value: number }
  /** "show numbers": click button n, or the button labelled like `text` */
  | { kind: 'pick'; n?: number; text?: string }

export type EditOp =
  | 'line' | 'home' | 'end' | 'up' | 'down' | 'left' | 'right' | 'wordLeft' | 'wordRight'
  | 'top' | 'bottom' | 'deleteLine' | 'deleteWord' | 'backspace' | 'selectLine' | 'selectAll'
  | 'newLine' | 'find' | 'undo' | 'redo'

export interface Match {
  action: Action
  /** what was done, for the screen ("Integrate", "gk = 2.5") */
  label: string
  /** the guess that matched */
  heard: string
  /** names that fit what was said equally well (ask which one) */
  ambiguous?: string[]
}

// ---- spoken numbers -----------------------------------------------------------
const UNITS: Record<string, number> = {
  zero: 0, nought: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
}
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }
const DIGIT: Record<string, string> = { zero: '0', oh: '0', o: '0', nought: '0', one: '1', two: '2', to: '2', too: '2', three: '3', four: '4', for: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9' }

/**
 * A number at tokens[i...]: "minus two point five", "twenty three",
 * "one hundred", "0.05", "one e minus three". Returns the value and the
 * tokens used, or null.
 */
export function readNumber(t: string[], i = 0): { value: number; used: number } | null {
  let k = i
  let sign = 1
  if (t[k] === 'minus' || t[k] === 'negative' || t[k] === '-') {
    sign = -1
    k++
  }
  // digits as the recognizer wrote them ("2.5", "-3", "1e-3")
  if (k < t.length && /^-?(\d+\.?\d*|\.\d+)(e-?\d+)?$/.test(t[k])) {
    let v = Number(t[k])
    k++
    // "2 point 5" (digits with a spoken point)
    if (t[k] === 'point' && /^\d+$/.test(t[k + 1] ?? '') && Number.isInteger(v)) {
      v = Number(`${v}.${t[k + 1]}`)
      k += 2
    }
    return { value: sign * v, used: k - i }
  }
  // words: an integer part (may be empty: "point five")
  let whole = 0
  let any = false
  let cur = 0
  // "to point five", "set x to to": a lone "to"/"for" where a number must be
  if ((t[k] === 'to' || t[k] === 'too' || t[k] === 'for') && (k + 1 === t.length || t[k + 1] === 'point')) {
    cur = t[k] === 'for' ? 4 : 2
    any = true
    k++
  }
  while (k < t.length) {
    const w = t[k]
    if (w in UNITS) {
      if (!any || (cur === 0 && whole > 0)) cur = UNITS[w] // "two thousand seven"
      else if (cur % 100 >= 20 && cur % 10 === 0 && UNITS[w] < 10) cur += UNITS[w] // twenty three
      else if (cur % 100 === 0 && cur > 0) cur += UNITS[w] // hundred five
      else break
      any = true
    } else if (w in TENS) {
      if (any && cur % 100 !== 0) break
      cur += TENS[w]
      any = true
    } else if (w === 'hundred' && any) {
      cur *= 100
    } else if (w === 'thousand' && any) {
      whole += cur * 1000
      cur = 0
    } else if (w === 'million' && any) {
      whole += cur * 1e6
      cur = 0
    } else if (w === 'a' && !any && (t[k + 1] === 'hundred' || t[k + 1] === 'thousand')) {
      cur = 1
      any = true
    } else if (w === 'and' && any && ((t[k + 1] ?? '') in UNITS || (t[k + 1] ?? '') in TENS)) {
      // "one hundred and five"
    } else break
    k++
  }
  let text = String(whole + cur)
  // "point" (sometimes heard as "prince", "pint") before a digit
  if (t[k] === 'point' || t[k] === 'dot' || ((t[k] === 'prince' || t[k] === 'pint' || t[k] === 'points') && (t[k + 1] ?? '') in DIGIT)) {
    let frac = ''
    let j = k + 1
    while (j < t.length && t[j] in DIGIT) {
      frac += DIGIT[t[j]]
      j++
    }
    // "point 05"
    if (!frac && /^\d+$/.test(t[j] ?? '')) frac = t[j++]
    if (frac) {
      text += '.' + frac
      k = j
      any = true
    }
  } else if (t[k] === 'half' && (t[k - 1] === 'a' || t[k - 1] === 'and')) {
    text = String(whole + cur + 0.5)
    k++
  }
  if (!any) return null
  let value = Number(text)
  // "one e minus three", "two times ten to the minus five"
  if (t[k] === 'e' || (t[k] === 'times' && t[k + 1] === 'ten' && t[k + 2] === 'to')) {
    const j = t[k] === 'e' ? k + 1 : k + (t[k + 3] === 'the' ? 4 : 3)
    let es = 1
    let m = j
    if (t[m] === 'minus' || t[m] === 'negative') {
      es = -1
      m++
    }
    const ex = readNumber(t, m)
    if (ex && Number.isInteger(ex.value)) {
      value *= 10 ** (es * ex.value)
      k = m + ex.used
    }
  }
  return { value: sign * value, used: k - i }
}

// ---- the model's names -----------------------------------------------------------
const LETTERS: Record<string, string> = {
  a: 'a', ay: 'a', b: 'b', be: 'b', bee: 'b', c: 'c', see: 'c', sea: 'c', d: 'd', dee: 'd', e: 'e',
  f: 'f', ef: 'f', eff: 'f', g: 'g', gee: 'g', jee: 'g', h: 'h', aitch: 'h', i: 'i', eye: 'i', j: 'j',
  jay: 'j', k: 'k', kay: 'k', okay: 'k', l: 'l', el: 'l', ell: 'l', m: 'm', em: 'm', n: 'n', en: 'n',
  o: 'o', oh: 'o', p: 'p', pee: 'p', pea: 'p', q: 'q', cue: 'q', queue: 'q', r: 'r', are: 'r', ar: 'r',
  s: 's', es: 's', ess: 's', t: 't', tee: 't', tea: 't', u: 'u', you: 'u', v: 'v', vee: 'v',
  w: 'w', x: 'x', ex: 'x', y: 'y', why: 'y', wye: 'y', z: 'z', zed: 'z', zee: 'z',
}
const NAME_DIGITS: Record<string, string> = { zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9' }

/** how a name may be said: the word itself, and spelled ("g k", "v one") */
export function spokenNames(name: string): string[] {
  const n = name.toLowerCase()
  const out = new Set<string>()
  if (/^[a-z]{3,}$/.test(n)) out.add(n)
  const spelled = n.replace(/_/g, '').split('').map((ch) => (/\d/.test(ch) ? Object.keys(NAME_DIGITS)[+ch] : ch)).join(' ')
  out.add(spelled)
  // words and digits: "v1" -> "v one", "gna" stays spelled, "tau2" -> "tau two"
  const m = n.match(/^([a-z]{3,})(\d+)$/)
  if (m) out.add(m[1] + ' ' + m[2].split('').map((d) => Object.keys(NAME_DIGITS)[+d]).join(' '))
  return [...out]
}

/** Levenshtein distance */
function dist(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}

/**
 * The model's names that tokens (all of them) may stand for, best first.
 * Names already in the model are the anchors: "g k" is gk, or g_k if that
 * is what the model has ("g underscore k" when it has both). `rank` orders
 * equally good candidates (the editor: the name nearest the cursor).
 */
export function nameCandidates(tokens: string[], names: string[], rank?: (name: string) => number, fuzzy = true): string[] {
  if (!tokens.length || !names.length) return []
  // XPP ignores case: gk and GK are one name
  names = [...new Map(names.map((n) => [n.toLowerCase(), n])).values()]
  const exact = (n: string) => n.toLowerCase()
  const loose = (n: string) => n.toLowerCase().replace(/_/g, '')
  const said: string[] = []
  said.push(tokens.join(''))
  // spelled: letters, digits, "underscore" ("g k", "v one", "gee kay", "tau two")
  const spelled = tokens.map((w) => (w === 'underscore' ? '_' : w in NAME_DIGITS ? NAME_DIGITS[w] : LETTERS[w] ?? (w.length >= 3 ? w : null)))
  if (spelled.every((x) => x !== null)) said.push(spelled.join(''))
  const order = (a: string[]) => (rank ? [...a].sort((x, y) => rank(x) - rank(y)) : a)
  for (const w of said) {
    // "underscore" said: exactly that name
    if (w.includes('_')) {
      const hit = names.filter((n) => exact(n) === w)
      if (hit.length) return hit
      continue // said with "underscore": only that name
    }
    // otherwise underscores are not heard: gk and g_k both fit "g k"
    // (the one written as said first, unless `rank` decides)
    const fit = names.filter((n) => loose(n) === w.replace(/_/g, ''))
    if (fit.length) return order(fit.sort((x, y) => +(exact(y) === w) - +(exact(x) === w)))
  }
  // close enough (a recognizer's spelling of a word): the nearest names,
  // but never a command word ("tap" is not tau)
  const joined = tokens.join('')
  if (fuzzy && joined.length >= 3 && !(tokens.length === 1 && commandWords().has(joined))) {
    const scored = names.map((n) => [n, dist(loose(n), joined)] as const).filter(([n, d]) => d <= (n.length >= 6 ? 2 : 1))
    if (scored.length) {
      const best = Math.min(...scored.map((x) => x[1]))
      return order(scored.filter((x) => x[1] === best).map((x) => x[0]))
    }
  }
  return []
}

let cmdWords: Set<string> | null = null
const commandWords = () =>
  (cmdWords ??= new Set(COMMANDS.flatMap((c) => c.say.flatMap((x) => x.split(' '))).filter((w) => !w.startsWith('{'))))

/** the model name that tokens stand for (the best candidate), or null */
export function readName(tokens: string[], names: string[], rank?: (name: string) => number): string | null {
  return nameCandidates(tokens, names, rank)[0] ?? null
}

// ---- commands -----------------------------------------------------------------------
interface Cmd {
  /** ways to say it; slots: {n} a number, {name} a model name, {line} "line" filler */
  say: string[]
  ctx: Context[]
  label: string
  act: (slots: Slots) => Action
  /** for "what can I say?" (first `say` is shown) */
  help?: string
  /** reject a reading of what was said (then another one is tried) */
  ok?: (slots: Slots) => boolean
}

const ALL: Context[] = ['xpp', 'auto', 'editor']
const XPP: Context[] = ['xpp']
const keys = (k: string[], to: 'main' | 'auto' | 'active' = 'main') => () => ({ kind: 'keys', keys: k, to }) as Action
const ui = (id: string) => () => ({ kind: 'ui', id }) as Action
const edit = (op: EditOp, n?: number) => (s: Slots) => ({ kind: 'edit', op, n: s.n ?? n, text: s.rest }) as Action

/** XPP's Numerics entries that take a value, and their keys */
export const NUMERICS: Array<[string[], string, string]> = [
  [['total', 'total time', 'end time', 'time'], 't', 'Total'],
  [['dt', 'd t', 'delta t', 'time step', 'step size'], 'd', 'Dt'],
  [['start time', 't zero', 't start'], 's', 'Start time'],
  [['transient'], 'r', 'Transient'],
  [['n out', 'n output', 'output'], 'o', 'nOutput'],
  [['bounds', 'bound'], 'b', 'Bounds'],
  [['max delay', 'delay'], 'e', 'Delay'],
]
const METHODS: Array<[string[], string, string]> = [
  [['runge kutta', 'r k', 'r k four', 'rk four'], 'r', 'Runge-Kutta'],
  [['euler'], 'e', 'Euler'],
  [['modified euler', 'mod euler'], 'm', 'Mod. Euler'],
  [['discrete'], 'd', 'Discrete'],
  [['adams'], 'a', 'Adams'],
  [['gear'], 'g', 'Gear'],
  [['stiff'], 's', 'Stiff'],
  [['c vode', 'cvode', 'see vode'], 'c', 'CVode'],
  [['dormand prince', 'dopri', 'dormand prince five', 'dopri five'], '5', 'DoPri(5)'],
  [['dormand prince eight', 'dopri eight'], '8', 'DoPri(8)'],
  [['rosenbrock', 'rosen'], '2', 'Rosen(2)'],
  [['backward euler', 'back euler'], 'b', 'BackEul'],
  [['qualitative runge kutta', 'qual r k'], 'q', 'QualRK4'],
  [['volterra'], 'v', 'Volterra'],
  [['symplectic'], 'y', 'Symplectic'],
]

export const COMMANDS: Cmd[] = [
  // anywhere
  { say: ['what can i say', 'help', 'show commands', 'commands'], ctx: ALL, label: 'What can I say?', act: ui('help') },
  { say: ['stop listening', 'go to sleep', 'stop voice', 'voice off'], ctx: ALL, label: 'Stop listening', act: ui('sleep') },
  { say: ['zoom in', 'bigger'], ctx: ['xpp', 'auto'], label: 'Zoom in', act: ui('zoomIn') },
  { say: ['zoom out', 'smaller'], ctx: ['xpp', 'auto'], label: 'Zoom out', act: ui('zoomOut') },
  { say: ['fit', 'fit screen', 'fit to screen', 'fit the screen'], ctx: ['xpp', 'auto'], label: 'Fit to screen', act: ui('fit') },
  { say: ['keyboard', 'show keyboard', 'hide keyboard', 'open keyboard', 'close keyboard'], ctx: ['xpp', 'auto'], label: 'Keyboard', act: ui('keyboard') },
  { say: ['escape', 'cancel', 'back', 'go back', 'never mind'], ctx: ['xpp', 'auto'], label: 'Esc', act: keys(['Escape'], 'active') },
  { say: ['enter', 'okay', 'ok', 'accept', 'yes', 'confirm'], ctx: ['xpp', 'auto'], label: 'Enter', act: keys(['Enter'], 'active') },
  { say: ['tab', 'next field'], ctx: ['xpp', 'auto'], label: 'Tab', act: keys(['Tab'], 'active') },

  // XPP's main window
  { say: ['integrate', 'go', 'run', 'initial conditions go', 'solve', 'simulate'], ctx: XPP, label: 'Integrate', act: keys(['i', 'g']) },
  { say: ['tap to start', 'pick initial condition', 'initial condition mouse', 'mouse', 'click to start'], ctx: XPP, label: 'Tap to start', act: keys(['i', 'i']) },
  { say: ['last', 'from last', 'start from last', 'initial conditions last'], ctx: XPP, label: 'From last', act: keys(['i', 'l']) },
  { say: ['continue', 'keep going', 'run longer'], ctx: XPP, label: 'Continue', act: keys(['c']) },
  { say: ['nullclines', 'null clines', 'draw nullclines', 'draw null clines', 'nullcline', 'null cline'], ctx: XPP, label: 'Nullclines', act: keys(['n', 'n']) },
  { say: ['direction field', 'draw direction field', 'vector field', 'flow field', 'direction fields'], ctx: XPP, label: 'Direction field', act: keys(['d', 'd']) },
  { say: ['erase', 'clear screen', 'clear the screen', 'clear graph', 'clear the graph', 'clear'], ctx: XPP, label: 'Erase', act: keys(['e']) },
  { say: ['window fit', 'fit window', 'fit graph', 'fit the graph', 'auto fit', 'rescale'], ctx: XPP, label: 'Fit window', act: keys(['w', 'f']) },
  { say: ['restore', 'redraw', 're draw'], ctx: XPP, label: 'Restore', act: keys(['r']) },
  { say: ['equilibria', 'equilibrium', 'fixed points', 'find fixed points', 'singular points', 'steady states', 'steady state', 'sing points'], ctx: XPP, label: 'Sing pts (go)', act: keys(['s', 'g']) },
  { say: ['fixed point here', 'equilibrium here', 'steady state here', 'singular point here'], ctx: XPP, label: 'Fixed point here', act: keys(['s', 'm']) },
  { say: ['x versus t', 'x vs t', 'plot versus time', 'versus time', 'time plot', 'x against t'], ctx: XPP, label: 'Xi vs t', act: keys(['x']) },
  { say: ['numerics', 'numerics menu', 'numerical settings'], ctx: XPP, label: 'Numerics', act: keys(['u']) },
  { say: ['auto', 'bifurcation', 'open auto', 'bifurcation diagram', 'start auto'], ctx: XPP, label: 'AUTO', act: keys(['f', 'a']) },
  { say: ['calculator', 'calculate'], ctx: XPP, label: 'Calculator', act: keys(['f', 'c']) },
  // newer XPPAUT (8.1 to 8.4) and the website's script menu
  { say: ['scripts', 'show scripts', 'open scripts', 'script menu', 'my scripts', 'list scripts'], ctx: XPP, label: 'Scripts', act: ui('scripts') },
  { say: ['do script', 'choose a script', 'choose script'], ctx: XPP, label: 'Do script', act: keys(['f', 'd']) },
  { say: ['new script', 'write a script', 'write script'], ctx: XPP, label: 'New script', act: ui('newScript') },
  { say: ['periodic', 'phase reduction', 'isostable', 'isostables', 'adjoint', 'initial conditions periodic'], ctx: XPP, label: 'Periodic (adjoint, isostables)', act: keys(['i', 'p']) },
  { say: ['make window', 'new window', 'create window', 'another window'], ctx: XPP, label: 'Create window', act: keys(['m', 'c']) },
  // Freeze opens XPP's Edit Freeze form: Tab accepts it as it is
  { say: ['freeze', 'freeze curve', 'freeze the curve', 'keep curve', 'keep this curve'], ctx: XPP, label: 'Freeze curve', act: keys(['g', 'f', 'f', 'Tab']) },
  { say: ['auto freeze', 'freeze automatically', 'keep every curve', 'keep all curves'], ctx: XPP, label: 'Auto freeze on/off', act: keys(['g', 'f', 'o']) },
  { say: ['remove frozen', 'remove frozen curves', 'delete frozen curves', 'clear frozen curves', 'unfreeze'], ctx: XPP, label: 'Remove frozen curves', act: keys(['g', 'f', 'r']) },
  { say: ['sliders', 'show sliders', 'hide sliders', 'parameter sliders'], ctx: XPP, label: 'Sliders', act: ui('sliders') },
  { say: ['share graph', 'share the graph', 'share picture'], ctx: XPP, label: 'Share graph', act: ui('shareGraph') },
  { say: ['save data', 'export data', 'data csv', 'save csv'], ctx: XPP, label: 'Data (CSV)', act: ui('csv') },
  { say: ['edit', 'edit model', 'edit the model', 'open editor', 'edit ode file', 'edit the file'], ctx: XPP, label: 'Edit .ode', act: ui('edit') },
  { say: ['tips', 'touch tips'], ctx: XPP, label: 'Tips', act: ui('tips') },
  {
    say: ['set {name} to {n}', '{name} equals {n}', '{name} is {n}', '{name} to {n}', 'change {name} to {n}', 'make {name} {n}', '{name} {n}', 'set {name} {n}', 'set {name} equal to {n}', 'set {name} equals {n}'],
    ctx: XPP,
    label: 'Set',
    act: (s) => ({ kind: 'set', name: s.name!, value: s.n! }),
    help: 'set gk to 2.5 (parameters and initial values)',
  },
  // Numerics entries: "total 200", "set dt to 0.01"
  ...NUMERICS.map(([words, key, label]): Cmd => ({
    say: words.flatMap((w) => [`set ${w} to {n}`, `${w} {n}`, `${w} to {n}`, `${w} equals {n}`, `${w} is {n}`, `set ${w} {n}`, `change ${w} to {n}`]),
    ctx: XPP,
    label,
    act: (s) => ({ kind: 'numeric', key, value: s.n!, label }),
    help: `${words[0]} 200`,
  })),
  ...METHODS.map(([words, key, label]): Cmd => ({
    say: words.flatMap((w) => [`method ${w}`, `use ${w}`, `integrate with ${w}`, `set method to ${w}`, `switch to ${w}`]),
    ctx: XPP,
    label: 'Method ' + label,
    act: () => ({ kind: 'menu', keys: ['u', 'm', key, 'Escape'] }),
    help: 'method runge kutta / euler / stiff / c vode / gear / dormand prince…',
  })),

  // AUTO window
  { say: ['run steady state', 'steady states', 'run steady states'], ctx: ['auto'], label: 'Run steady state', act: keys(['r', 's'], 'auto') },
  { say: ['run periodic', 'periodic', 'periodic orbits', 'periodic orbit', 'run periodic orbits'], ctx: ['auto'], label: 'Run periodic', act: keys(['r', 'p'], 'auto') },
  { say: ['two parameter', 'two parameters', 'two param', 'two parameter curve', 'two par'], ctx: ['auto'], label: 'Two parameter', act: keys(['r', 't'], 'auto') },
  { say: ['reset diagram', 'clear diagram', 'reset the diagram', 'new diagram'], ctx: ['auto'], label: 'Reset diagram', act: keys(['f', 'r'], 'auto') },
  { say: ['run', 'run auto', 'go', 'compute', 'start', 'steady state'], ctx: ['auto'], label: 'Run', act: keys(['r'], 'auto') },
  { say: ['grab', 'grab point', 'grab a point', 'pick point'], ctx: ['auto'], label: 'Grab', act: keys(['g'], 'auto') },
  { say: ['next point', 'right', 'next', 'forward'], ctx: ['auto'], label: 'Point ▶', act: keys(['ArrowRight'], 'active') },
  { say: ['previous point', 'left', 'previous', 'back one'], ctx: ['auto'], label: '◀ Point', act: keys(['ArrowLeft'], 'active') },
  { say: ['next label', 'jump', 'next special point'], ctx: ['auto'], label: 'Next label', act: keys(['Tab'], 'active') },
  { say: ['grab it', 'take it', 'take this one', 'this one', 'select it'], ctx: ['auto'], label: 'Grab it', act: keys(['Enter'], 'active') },
  { say: ['parameter', 'parameters', 'choose parameter'], ctx: ['auto'], label: 'Parameter', act: keys(['p'], 'auto') },
  { say: ['axes', 'axis', 'set axes'], ctx: ['auto'], label: 'Axes', act: keys(['a'], 'auto') },
  { say: ['numerics', 'auto numerics'], ctx: ['auto'], label: 'Numerics', act: keys(['n'], 'auto') },
  { say: ['user period', 'usr period'], ctx: ['auto'], label: 'Usr period', act: keys(['u'], 'auto') },
  { say: ['clear', 'clear graph', 'erase'], ctx: ['auto'], label: 'Clear', act: keys(['c'], 'auto') },
  { say: ['redraw', 're draw', 'draw again'], ctx: ['auto'], label: 'reDraw', act: keys(['d'], 'auto') },
  { say: ['file', 'file menu'], ctx: ['auto'], label: 'File', act: keys(['f'], 'auto') },
  { say: ['xpp window', 'main window', 'xpp', 'back to xpp', 'phase plane'], ctx: ['auto'], label: 'XPP window', act: ui('mainWindow') },

  // cursor and editing: the .ode editor, and XPP's prompt line ("xpp")
  { say: ['go to line {n}', 'line {n}', 'jump to line {n}', 'goto line {n}'], ctx: ['editor'], label: 'Go to line', act: edit('line'), help: 'go to line 23' },
  { say: ['go to end of line', 'end of line', 'end of the line', 'go to the end of the line', 'go to end of the line', 'go to the end of line', 'end'], ctx: ['editor', 'xpp', 'auto'], label: 'End of line', act: edit('end') },
  { say: ['go to start of line', 'start of line', 'beginning of line', 'go to beginning of line', 'start of the line', 'beginning of the line', 'go to the start of the line', 'go to the beginning of the line', 'home'], ctx: ['editor', 'xpp', 'auto'], label: 'Start of line', act: edit('home') },
  { say: ['move up', 'up', 'line up', 'previous line', 'go up', 'move up {n}', 'up {n}', 'move up {n} lines', 'up {n} lines', 'go up {n} lines', 'move up {n} line', 'up {n} line'], ctx: ['editor', 'xpp', 'auto'], label: 'Up', act: edit('up', 1), help: 'move up / move up 3 lines' },
  { say: ['move down', 'down', 'line down', 'next line', 'go down', 'move down {n}', 'down {n}', 'move down {n} lines', 'down {n} lines', 'go down {n} lines', 'move down {n} line', 'down {n} line'], ctx: ['editor', 'xpp', 'auto'], label: 'Down', act: edit('down', 1), help: 'move down / move down 3 lines' },
  { say: ['move left', 'left', 'move left {n}', 'left {n}', 'back {n}', 'move left {n} characters', 'left {n} characters'], ctx: ['editor'], label: 'Left', act: edit('left', 1) },
  { say: ['move right', 'right', 'move right {n}', 'right {n}', 'forward {n}', 'move right {n} characters', 'right {n} characters'], ctx: ['editor'], label: 'Right', act: edit('right', 1) },
  { say: ['move left', 'cursor left', 'move left {n}'], ctx: ['xpp', 'auto'], label: 'Left', act: edit('left', 1) },
  { say: ['move right', 'cursor right', 'move right {n}'], ctx: ['xpp', 'auto'], label: 'Right', act: edit('right', 1) },
  { say: ['next word', 'word right', 'forward a word', 'next word {n}'], ctx: ['editor'], label: 'Next word', act: edit('wordRight', 1) },
  { say: ['previous word', 'word left', 'back a word', 'last word'], ctx: ['editor'], label: 'Previous word', act: edit('wordLeft', 1) },
  { say: ['go to top', 'top', 'go to the top', 'start of file', 'beginning of file', 'top of file', 'go to start of file'], ctx: ['editor'], label: 'Top', act: edit('top') },
  { say: ['go to bottom', 'bottom', 'go to the bottom', 'end of file', 'bottom of file', 'go to end of file'], ctx: ['editor'], label: 'Bottom', act: edit('bottom') },
  { say: ['erase the line', 'erase line', 'delete line', 'delete the line', 'remove line', 'remove the line', 'clear line', 'clear the line', 'delete this line', 'erase this line', 'kill line'], ctx: ['editor', 'xpp', 'auto'], label: 'Erase the line', act: edit('deleteLine') },
  { say: ['delete word', 'delete the word', 'erase word', 'delete last word', 'delete previous word', 'remove word'], ctx: ['editor'], label: 'Delete word', act: edit('deleteWord') },
  { say: ['backspace', 'delete', 'backspace {n}', 'delete {n}', 'delete {n} characters', 'delete character'], ctx: ['editor', 'xpp', 'auto'], label: 'Backspace', act: edit('backspace', 1) },
  { say: ['select line', 'select the line', 'select this line'], ctx: ['editor'], label: 'Select line', act: edit('selectLine') },
  { say: ['select all', 'select everything'], ctx: ['editor'], label: 'Select all', act: edit('selectAll') },
  { say: ['new line', 'newline', 'enter', 'return', 'insert line', 'add line', 'add a line'], ctx: ['editor'], label: 'New line', act: edit('newLine') },
  { say: ['undo', 'scratch that', 'undo that', 'oops'], ctx: ['editor'], label: 'Undo', act: edit('undo') },
  { say: ['redo', 'redo that'], ctx: ['editor'], label: 'Redo', act: edit('redo') },
  { say: ['find {rest}', 'search for {rest}', 'search {rest}', 'where is {rest}', 'jump to {rest}'], ctx: ['editor'], label: 'Find', act: edit('find'), help: 'find gk / where is gk' },
  { say: ['close editor', 'close the editor', 'close', 'done editing'], ctx: ['editor'], label: 'Close editor', act: ui('closeEditor') },
  { say: ['check', 'check model', 'check the model', 'problems', 'show problems'], ctx: ['editor'], label: 'Show problems', act: ui('problems') },

  // the model's settings, written as @ options (broad, top-level commands)
  {
    say: [
      ...['set', 'change', 'make', 'increase', 'decrease', 'raise', 'lower', 'reduce', 'put', 'update', 'switch', 'turn'].flatMap((v) => [
        `${v} {opt} to {v}`, `${v} {opt} equal to {v}`, `${v} {opt} equals {v}`, `${v} {opt} {v}`,
      ]),
      // (no "<setting> equals ...": in the editor that is a dictated line)
      '{opt} to {v}', '{opt} {v}', 'use {opt} {v}',
    ],
    ctx: ['editor'],
    label: 'Setting',
    act: (s) => ({ kind: 'option', set: [[s.opt!, s.v!]] }),
    help: 'change the integration method to stiff / increase maximum storage to 100000 / total time 200 / tolerance 1e-6 / bell off',
  },
  {
    say: ['use {method}', 'integrate with {method}', 'switch to {method}', 'method {method}', 'solve with {method}'],
    ctx: ['editor'],
    label: 'Method',
    act: (s) => ({ kind: 'option', set: [['meth', s.method!]] }),
  },
  ...([['x', 'xlo', 'xhi'], ['y', 'ylo', 'yhi'], ['parameter', 'parmin', 'parmax'], ['auto x', 'autoxmin', 'autoxmax'], ['auto y', 'autoymin', 'autoymax'], ['bifurcation x', 'autoxmin', 'autoxmax'], ['bifurcation y', 'autoymin', 'autoymax']] as const).map(
    ([w, lo, hi]): Cmd => ({
      say: ['', 'set ', 'change ', 'make '].flatMap((v) => [`${v}${w} range {n} to {n2}`, `${v}${w} range from {n} to {n2}`, `${v}${w} from {n} to {n2}`, `${v}${w} axis from {n} to {n2}`, `${v}${w} limits {n} to {n2}`]),
      ctx: ['editor'],
      label: `${w} range`,
      ok: (s) => s.n! < s.n2!,
      act: (s) => ({ kind: 'option', set: [[lo, formatValue('number', s.n!)], [hi, formatValue('number', s.n2!)]] }),
      help: `${w} range minus 2 to 2`,
    }),
  ),
  {
    say: ['plot {name} against {name2}', 'plot {name} versus {name2}', 'plot {name} vs {name2}', 'graph {name} against {name2}', 'show {name} against {name2}'],
    ctx: ['editor'],
    label: 'Axes',
    act: (s) => ({ kind: 'option', set: [['xp', s.name2!], ['yp', s.name!]] }),
    help: 'plot w against v (y axis w, x axis v)',
  },
  {
    // with a verb only: "x equals 2" in the editor is a dictated line
    say: ['set {name} to {n}', 'change {name} to {n}', 'make {name} {n}', 'set {name} equal to {n}', 'set {name} equals {n}', 'set {name} {n}'],
    ctx: ['editor'],
    label: 'Value',
    act: (s) => ({ kind: 'value', name: s.name!, value: s.n! }),
    help: 'set gk to 50 (its value in the file)',
  },
]

// "show numbers" and clicking (last: every specific command comes first)
COMMANDS.push(
  { say: ['show numbers', 'numbers', 'number the buttons', 'show labels', 'numbers on', 'show the numbers'], ctx: ['xpp', 'auto'], label: 'Show numbers', act: ui('numbersOn'), help: 'show numbers (then say a number to click it)' },
  { say: ['hide numbers', 'numbers off', 'no numbers', 'hide the numbers'], ctx: ['xpp', 'auto'], label: 'Hide numbers', act: ui('numbersOff') },
  { say: ['{n}', 'number {n}', 'click {n}', 'tap {n}', 'press {n}', 'click number {n}', 'choose {n}', 'pick {n}', 'select {n}'], ctx: ['xpp', 'auto'], label: 'Click', act: (s) => ({ kind: 'pick', n: s.n }), help: 'seven / click seven (with numbers shown)' },
  { say: ['click on {rest}', 'click {rest}', 'press {rest}', 'tap {rest}', 'push {rest}'], ctx: ['xpp', 'auto'], label: 'Click', act: (s) => ({ kind: 'pick', text: s.rest }), help: 'click nullcline (a button by its label)' },
)

const OPT_PHRASES: Array<[string[], string]> = OPTIONS.map((o) => [o.say, o.key])
const METHOD_PHRASES: Array<[string[], string]> = METHOD_VALUES.map(([says, v]) => [says, v])

// ---- matching ------------------------------------------------------------------------
/** what a recognizer wrote -> lower-case words (keeps numbers like 2.5, -3) */
// what Vosk, Whisper and the browsers' recognisers wrote for "nullcline(s)",
// said by several voices and speeds (and the usual mishearings): a first
// sound like null / now / no / knoll / nell, then cline / clients / climb /
// kinds / claims / coins / plans ..., apart or glued
const NC_FIRST = '(?:null|nul|nall|nal|nalt|nell|nel|knoll|noll|knock|knelt|now|no|nought|nu|nol|north|troll|an all|then all|on all|n all|in all|and all)'
const NC_SECOND = '(?:clines?|clined|cline|points?|clients?|climbs?|climb|claims?|clings?|kinds?|kind|kleins?|klein|coins?|coin|plans?|plan|plants?|pliance|blinds?|blind|lions?|lines?|line|glines|gines|clang|fling|blings|play)'
const NULLCLINE_SPLIT = new RegExp(`(?<=^|\\s)${NC_FIRST}\\s*${NC_SECOND}(?=\\s|$)`, 'g')
const NULLCLINE_GLUED = /(?<=^|\s)(?:chono|nul|nal|nalt|nel|now|no|knock|note|null|nell)[a-z]{0,2}(?:clines?|cline|klines?|clang|gines|kinds?|kind|plans?|blings|lines?|line)(?=\s|$)/g

/** what the user taught (Settings -> Voice -> Teach): what the recognizer
 *  writes when they say a command, and the command's phrase */
let taught: Array<[RegExp, string]> = []
export function setTaught(list: Array<{ heard: string; say: string }>) {
  taught = list
    .filter((x) => x.heard.trim() && x.say.trim())
    .sort((a, b) => b.heard.length - a.heard.length)
    .map((x) => [new RegExp(`(?<=^|\\s)${x.heard.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'g'), x.say])
}

export function words(text: string): string[] {
  let t = text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/(\d)e-(\d)/g, '$1e_$2') // 1e-3 stays one token
    .replace(/(\d),(\d{3})/g, '$1$2')
    .replace(/(^|\s)-(?=\d)/g, '$1minus ')
    .replace(/(\d)\s*-\s*(\d)/g, '$1 minus $2') // never a range
    .replace(/[^a-z0-9._\s]/g, ' ')
    .replace(/(?<!\d)\.|\.(?!\d)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  // the user's own ways of saying commands, first
  for (const [re, say] of taught) t = t.replace(re, say)
  // "nullcline(s)" is the word recognisers hear worst (null clients, now
  // climb, no kinds, knoll climbs, nalcline, ...): its own rule, first
  t = t
    .replace(NULLCLINE_SPLIT, 'nullclines')
    .replace(NULLCLINE_GLUED, 'nullclines')
    // its first half alone ("null", "knoll"; not "no" or "now") or second half alone ("clines")
    .replace(/(^|\s)(?:null|nul|knoll|nell|nall|noll|clines?)(?=\s|$)/g, '$1nullclines')
  for (const [re, word] of SOUND_RE) t = t.replace(re, word)
  // spoken forms of words the offline model lacks ("cube helix" = cubehelix)
  for (const [re, word] of learned) t = t.replace(re, word)
  return t.split(' ').filter(Boolean).map((w) => w.replace('e_', 'e-'))
}

/**
 * Command words that Vosk's small English model does not know, said with
 * words it does know (checked against its word list); what it then writes
 * is turned back into the command word before matching.
 */
export const SOUNDALIKES: Array<[string, string]> = [
  ['null clines', 'nullclines'], ['null cline', 'nullcline'], ['null lines', 'nullclines'],
  ['re scale', 'rescale'], ['numeric', 'numerics'], ['numerical', 'numerics'],
  ['runge cutter', 'runge kutta'], ['run cutter', 'runge kutta'], ['range cutter', 'runge kutta'],
  ['see vote', 'cvode'], ['c vote', 'cvode'], ['sea vote', 'cvode'], ['c vode', 'cvode'],
  ['dorman prince', 'dormand prince'], ['door man prince', 'dormand prince'],
  ['dope re', 'dopri'], ['rosen brock', 'rosenbrock'], ['simple tick', 'symplectic'],
  ['back space', 'backspace'], ['new line', 'newline'], ['x p p', 'xpp'], ['x b p', 'xpp'],
  ['simulate tick', 'symplectic'], ['no clines', 'nullclines'], ['no claims', 'nullclines'], ['null claims', 'nullclines'], ['nul clines', 'nullclines'], ['now clines', 'nullclines'], ['no cline', 'nullcline'], ['goto', 'go to'], ['sat', 'set'], ['sit', 'set'],
]
const SOUND_RE = SOUNDALIKES.map(([said, word]) => [new RegExp(`\\b${said}\\b`, 'g'), word] as const)

// polite or filler words that may wrap a command
const FILLER = new Set(['so', 'please', 'now', 'hey', 'and', 'then', 'could', 'you', 'can', 'the', 'uh', 'um', 'just'])
const strip = (t: string[]) => {
  let a = 0
  let b = t.length
  while (a < b && FILLER.has(t[a])) a++
  while (b > a && (t[b - 1] === 'please' || t[b - 1] === 'now' || t[b - 1] === 'thanks')) b--
  return t.slice(a, b)
}

/** match one phrase pattern against tokens; slot values, or null */
type Slots = { n?: number; n2?: number; name?: string; name2?: string; rest?: string; others?: string[]; opt?: string; v?: string; method?: string }
function matchPattern(pat: string[], t: string[], names: string[], rank?: (n: string) => number, ok?: (s: Slots) => boolean): Slots | null {
  const slots: Slots = {}
  const go = (p: number, i: number): boolean => {
    if (p === pat.length) return i === t.length && (!ok || ok(slots))
    const w = pat[p]
    if (w === '{n}' || w === '{n2}') {
      // longest number first, then shorter ones: "one point to to five" is
      // 1.2 then "to" then 5 ("to" is often "two")
      for (let j = t.length; j > i; j--) {
        const r = readNumber(t.slice(0, j), i)
        if (!r || r.used !== j - i) continue
        if (w === '{n}') slots.n = r.value
        else slots.n2 = r.value
        if (go(p + 1, j)) return true
      }
      return false
    }
    if (w === '{rest}') {
      if (i >= t.length) return false
      slots.rest = t.slice(i).join(' ')
      return true
    }
    // a phrase from a list at t[i...] (longest first)
    const phrase = (list: Array<[string[], string]>, set: (v: string) => void) => {
      const opts = list.flatMap(([says, v]) => says.map((x) => [x.split(' '), v] as const)).sort((a, b) => b[0].length - a[0].length)
      for (const [ws, v] of opts) {
        if (!ws.every((x, k) => t[i + k] === x)) continue
        set(v) // before the rest: a {v} after an {opt} needs to know which
        if (go(p + 1, i + ws.length)) return true
      }
      return false
    }
    if (w === '{opt}') return phrase(OPT_PHRASES, (v) => (slots.opt = v))
    if (w === '{method}') return phrase(METHOD_PHRASES, (v) => (slots.method = v))
    if (w === '{v}') {
      // the value of the option just matched, by its kind
      const def = OPTIONS.find((o) => o.key === slots.opt)
      if (!def) return false
      if (def.kind === 'number' || def.kind === 'int') {
        for (let j = t.length; j > i; j--) {
          const r = readNumber(t.slice(0, j), i)
          if (!r || r.used !== j - i) continue
          slots.v = formatValue(def.kind, r.value)
          if (go(p + 1, j)) return true
        }
        return false
      }
      if (def.kind === 'method') return phrase(METHOD_PHRASES, (v) => (slots.v = v))
      if (def.kind === 'onoff') return phrase([[['on', 'yes', 'true'], '1'], [['off', 'no', 'false'], '0']], (v) => (slots.v = v))
      for (let j = i + 1; j <= Math.min(t.length, i + 5); j++) {
        const c = nameCandidates(t.slice(i, j), names, rank)
        if (c.length && go(p + 1, j)) {
          slots.v = c[0]
          return true
        }
      }
      return false
    }
    if (w === '{name2}') {
      for (let j = i + 1; j <= Math.min(t.length, i + 5); j++) {
        const c = nameCandidates(t.slice(i, j), names, rank)
        if (c.length && go(p + 1, j)) {
          slots.name2 = c[0]
          return true
        }
      }
      return false
    }
    if (w === '{name}') {
      // the name is the shortest run of tokens that names something
      for (let j = i + 1; j <= Math.min(t.length, i + 5); j++) {
        const c = nameCandidates(t.slice(i, j), names, rank)
        if (c.length && go(p + 1, j)) {
          slots.name = c[0]
          // a tie that the ranking does not settle
          const tied = rank ? c.filter((x) => rank(x) === rank(c[0])) : c
          if (tied.length > 1) slots.others = tied
          return true
        }
      }
      return false
    }
    return t[i] === w && go(p + 1, i + 1)
  }
  return go(0, 0) ? slots : null
}

/** the action for what was heard (guesses best first), in this context */
export function interpret(alts: string[], ctx: Context, names: string[], rank?: (name: string) => number): Match | null {
  const cmds = COMMANDS.filter((c) => c.ctx.includes(ctx))
  for (const heard of alts) {
    const t = strip(words(heard)).filter((w) => w !== 'the')
    if (!t.length) continue
    for (const c of cmds)
      for (const s of c.say) {
        const slots = matchPattern(s.split(' ').filter((w) => w !== 'the'), t, names, rank, c.ok)
        if (!slots) continue
        const action = c.act(slots)
        return { action, label: describe(c, action), heard, ambiguous: slots.others }
      }
  }
  // nothing exact: the nearest fixed phrase, if it is close (a word or two
  // misheard: "integrated", "null client")
  let best: { c: Cmd; d: number; heard: string } | null = null
  for (const heard of alts.slice(0, 3)) {
    // something was not understood: no guessing
    if (heard.includes('[unk]')) continue
    const s = strip(words(heard)).filter((w) => w !== 'the').join(' ')
    if (s.length < 4) continue
    for (const c of cmds)
      for (const p of c.say) {
        if (p.includes('{')) continue
        const q = p.split(' ').filter((w) => w !== 'the').join(' ')
        const raw = dist(s, q)
        const d = raw / Math.max(q.length, 4)
        // a letter or two wrong ("integrated", "null client"), not more
        if (d <= 0.25 && raw <= 3 && (!best || d < best.d)) best = { c, d, heard }
      }
  }
  if (best) {
    const action = best.c.act({})
    return { action, label: describe(best.c, action), heard: best.heard }
  }
  return null
}

function describe(c: Cmd, a: Action): string {
  const num = (v: number) => String(+v.toPrecision(10))
  if (a.kind === 'set' || a.kind === 'value') return `${a.name} = ${num(a.value)}`
  if (a.kind === 'option') return a.set.map(([k, v]) => `${k}=${v}`).join(', ')
  if (a.kind === 'pick') return a.n !== undefined ? `Click ${a.n}` : `Click “${a.text}”`
  if (a.kind === 'numeric') return `${a.label} = ${num(a.value)}`
  if (a.kind === 'edit' && a.op === 'line') return `Line ${a.n}`
  if (a.kind === 'edit' && a.op === 'find') return `Find “${a.text}”`
  if (a.kind === 'edit' && a.n && a.n > 1) return `${c.label} ${a.n}`
  return c.label
}

// ---- for the recognizers ----------------------------------------------------------
const NUMBER_WORDS = [...Object.keys(UNITS), ...Object.keys(TENS), 'hundred', 'thousand', 'million', 'point', 'minus', 'negative', 'e', 'times', 'ten', 'to', 'the', 'half', 'a', 'and']

/**
 * The words Vosk may hear in this context (its grammar): every word of the
 * commands, number words, and the model's names said or spelled. Anything
 * else comes out as "[unk]".
 */
export function vocabulary(ctx: Context, names: string[]): string[] {
  const out = new Set<string>(NUMBER_WORDS)
  for (const c of COMMANDS)
    if (c.ctx.includes(ctx)) for (const s of c.say) for (const w of s.split(' ')) if (!w.startsWith('{')) out.add(w)
  for (const w of FILLER) out.add(w)
  for (const [said] of SOUNDALIKES) for (const w of said.split(' ')) out.add(w)
  for (const w of learnedWords) out.add(w)
  out.add('underscore')
  // words inside slots: settings, methods, on/off
  if (ctx === 'editor') for (const o of OPTIONS) for (const x of o.say) for (const w of x.split(' ')) out.add(w)
  for (const [says] of METHOD_VALUES) for (const x of says) for (const w of x.split(' ')) out.add(w)
  for (const w of ['on', 'off', 'yes', 'no', 'range', 'from', 'against', 'versus', 'vs', 'plot']) out.add(w)
  for (const n of names) for (const s of spokenNames(n)) for (const w of s.split(' ')) out.add(w)
  // letters for spelled names
  for (const l of 'abcdefghijklmnopqrstuvwxyz') out.add(l)
  return [...out]
}

/** names to bias Android's recognizer toward (it takes phrases) */
export function biasPhrases(ctx: Context, names: string[]): string[] {
  const out = new Set<string>()
  for (const n of names) out.add(n)
  for (const c of COMMANDS) if (c.ctx.includes(ctx)) out.add(c.say[0].replace(/\{n\}|\{name\}|\{rest\}/g, '').trim())
  return [...out].filter(Boolean).slice(0, 200)
}

/** "what can I say?" for a context: [phrase, what it does] */
export function helpFor(ctx: Context): Array<[string, string]> {
  const seen = new Set<string>()
  const out: Array<[string, string]> = []
  for (const c of COMMANDS) {
    if (!c.ctx.includes(ctx)) continue
    const key = c.help ?? c.say[0]
    if (seen.has(key)) continue
    seen.add(key)
    const plain = c.say.filter((s) => !s.includes('{')).slice(0, 2).join(' / ')
    const example = (x: string) => x.replace('{n}', '3').replace('{n2}', '5').replace('{name}', 'gk').replace('{name2}', 'v').replace('{method}', 'stiff').replace('{rest}', 'gk')
    out.push([c.help ?? (plain || c.say.slice(0, 2).map(example).join(' / ')), c.label])
  }
  return out
}

// ---- the user's own commands (the Cmd panel's labels and phrases) -------------
/** text as the commands compare it: plain words, no filler, no "the" */
export function plainWords(text: string): string {
  return strip(words(text)).filter((w) => w !== 'the').join(' ')
}

/**
 * The item whose phrases fit what was heard (guesses best first): exactly,
 * or with `near`, a letter or two off (as the built-in commands allow).
 * Phrases are compared as plainWords.
 */
/** "dormand prince 5" and "dormand prince five" compare equal: numbers as words */
function numbersAsWords(text: string): string {
  return text
    .split(' ')
    .map((w) => {
      if (!/^\d+$/.test(w) || +w >= 100) return w
      const n = +w
      const unit = Object.keys(UNITS).find((k) => UNITS[k] === n % (n < 20 ? 100 : 10))
      if (n < 20) return unit ?? w
      const ten = Object.keys(TENS).find((k) => TENS[k] === n - (n % 10))
      return n % 10 ? `${ten} ${unit}` : ten ?? w
    })
    .join(' ')
}

export function matchPhrase<T extends { phrases: string[] }>(alts: string[], items: T[], near = false): T | null {
  const all = items.flatMap((it) => it.phrases.map((p) => [numbersAsWords(plainWords(p)), it] as const)).filter(([p]) => p)
  for (const heard of alts) {
    const h = numbersAsWords(plainWords(heard))
    if (!h) continue
    const hit = all.find(([p]) => p === h)
    if (hit) return hit[1]
  }
  if (!near) return null
  let best: { it: T; d: number } | null = null
  for (const heard of alts.slice(0, 3)) {
    if (heard.includes('[unk]')) continue
    const h = numbersAsWords(plainWords(heard))
    if (h.length < 4) continue
    for (const [p, it] of all) {
      const raw = dist(h, p)
      const d = raw / Math.max(p.length, 4)
      if (d <= 0.25 && raw <= 3 && (!best || d < best.d)) best = { it, d }
    }
  }
  return best?.it ?? null
}

// ---- words the offline model (Vosk) lacks -----------------------------------------
// Vosk only writes words of its own dictionary, so "cubehelix", "bvp" or "3d"
// can never come out of it. Each such word gets a spoken form made of words
// it has (a compound split, digits as words, or letters spelled), which
// words() turns back into the word, like SOUNDALIKES. The app loads the
// model's word list (public/voice/vosk-words.txt) and calls learnWords().
let offline: Set<string> = new Set()
let learned: Array<[RegExp, string]> = []
let learnedWords: string[] = []
const formCache = new Map<string, string | null>()
const DIGIT_NAMES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']
/** better than a split for these (said differently than written) */
const HAND: Record<string, string> = { liapunov: 'lee a poon off', lyapunov: 'lee a poon off', dormand: 'dorman', noutput: 'n output', qualst: 'qual st', xpprc: 'x p p r c' }

/** the offline model's dictionary (the app sets it once it is loaded) */
export function setOfflineWords(words: Set<string>) {
  offline = words
  formCache.clear()
}

/** a word some SOUNDALIKES entry already produces (nullclines, kutta, cvode...) */
const bySoundalike = (w: string) => SOUNDALIKES.some(([, to]) => to.split(' ').includes(w))

/** fewest dictionary words (at most 3, each 2+ letters) that spell w, or null */
function splitKnown(w: string): string | null {
  const best: Array<string[] | null> = [[]]
  for (let i = 1; i <= w.length; i++) {
    best[i] = null
    for (let j = Math.max(0, i - 20); j <= i - 2; j++) {
      const prev = best[j]
      const piece = w.slice(j, i)
      if (prev && prev.length < 3 && offline.has(piece) && (!best[i] || prev.length + 1 < best[i]!.length)) best[i] = [...prev, piece]
    }
  }
  const b = best[w.length]
  return b && b.length > 1 ? b.join(' ') : null
}

/**
 * How to say a word the offline model lacks, in words it has: "cube helix",
 * "three d", "b v p". null when the model knows the word, a soundalike already
 * covers it, or no word list is loaded.
 */
export function spokenForm(word: string): string | null {
  const w = word.toLowerCase()
  if (!offline.size || offline.has(w) || w.length < 2 || /^\d+(\.\d+)?$/.test(w) || bySoundalike(w)) return null
  if (formCache.has(w)) return formCache.get(w)!
  let f: string | null = null
  const hand = HAND[w]
  if (hand && hand.split(' ').every((x) => x.length === 1 || offline.has(x))) f = hand
  else if (/\d/.test(w))
    f = (w.match(/\d+|[a-z_]+/g) ?? [])
      // digits as words; short letter runs spelled ("rk4" = "r k four", "3d" = "three d")
      .map((r) => (/\d/.test(r) ? r.split('').map((d) => DIGIT_NAMES[+d]).join(' ') : r.length <= 3 ? r.split('').join(' ') : offline.has(r) ? r : splitKnown(r) ?? r.split('').join(' ')))
      .join(' ')
  else f = splitKnown(w) ?? w.replace(/_/g, '').split('').join(' ')
  formCache.set(w, f)
  return f
}

/** spelled letter by letter ("b v p"): worth telling the user */
export const isSpelled = (form: string) => form.split(' ').every((x) => x.length === 1)

/**
 * Learn the spoken forms of the unknown words in the built-in commands and
 * in `phrases` (the Cmd panel's labels and the user's phrases). Cheap to
 * call again; forms are cached.
 */
export function learnWords(phrases: string[] = []) {
  if (!offline.size) return
  const raw = new Set<string>()
  const add = (text: string) => {
    // the written words, before any spoken-form rewriting
    for (const w of text.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9_\s]/g, ' ').split(/\s+/)) if (w && !w.startsWith('{')) raw.add(w)
  }
  for (const c of COMMANDS) for (const x of c.say) add(x)
  for (const p of phrases) add(p)
  const pairs: Array<[string, string]> = []
  for (const w of raw) {
    const f = spokenForm(w)
    if (f && f !== w) pairs.push([f, w])
  }
  // longer forms first ("auto correlation" before "auto")
  pairs.sort((a, b) => b[0].length - a[0].length)
  learned = pairs.map(([f, w]) => [new RegExp(`\\b${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), w] as [RegExp, string])
  learnedWords = [...new Set(pairs.flatMap(([f]) => f.split(' ')))]
}
