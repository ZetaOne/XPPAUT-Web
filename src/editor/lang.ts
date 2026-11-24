// XPP's two languages for the editors: .ode models and .xps scripts. One
// small tokenizer, used by CodeMirror (StreamLanguage) and by Monaco
// (a TokensProvider), so both colour the same way.

export type Tok = 'comment' | 'keyword' | 'option' | 'number' | 'string' | 'function' | 'variable' | 'operator' | 'command' | 'deriv' | null

export const ODE_KEYWORDS = new Set(['par', 'param', 'params', 'parameter', 'parameters', 'p', 'init', 'i', 'aux', 'a', 'number', 'n', 'table', 't', 'wiener', 'w', 'global', 'g', 'markov', 'm', 'bdry', 'b', 'done', 'd', 'set', 'options', 'o', 'special', 'volterra', 'export', 'only'])
export const ODE_FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sinh', 'cosh', 'tanh', 'exp', 'ln', 'log', 'log10', 'sqrt', 'abs', 'heav', 'sign', 'mod', 'flr', 'ceil',
  'max', 'min', 'delay', 'ran', 'normal', 'besselj', 'bessely', 'erf', 'erfc', 'gamma', 'lgamma', 'if', 'then', 'else', 'sum', 'of', 'shift', 'del_shft', 'int',
  'pi', 'hom_bcs', 'lgamma', 'poisson', 'arccos', 'arcsin', 'arctan',
])
export const XPS_COMMANDS = new Set(['set', 'print', 'keys', 'autokeys', 'ans', 'ok', 'cancel', 'auto', 'msg', 'pause', 'wait', 'speed', 'shot', 'for', 'end', 'repeat', 'try', 'else', 'quit', 'click', 'drag', 'browsekeys'])

export interface TokState {
  lineStart: boolean
  option: boolean
}

export const startState = (): TokState => ({ lineStart: true, option: false })

/** read one token from `s` (a stream over one line); its style */
export interface Stream {
  sol(): boolean
  eol(): boolean
  peek(): string | undefined
  next(): string | undefined
  match(re: RegExp): RegExpMatchArray | null | boolean
  skipToEnd(): void
  eatSpace(): boolean
  current(): string
}

export function tokenOde(s: Stream, st: TokState): Tok {
  if (s.sol()) {
    st.lineStart = true
    st.option = false
  }
  if (s.eatSpace()) return null
  const first = st.lineStart
  st.lineStart = false
  if (s.match(/^#.*/)) return 'comment'
  if (first && s.match(/^"/)) {
    s.skipToEnd() // a tutorial line
    return 'string'
  }
  if (first && s.match(/^@/)) {
    st.option = true
    return 'keyword'
  }
  if (s.match(/^[0-9]*\.?[0-9]+(?:e[-+]?[0-9]+)?/i)) return 'number'
  const w = s.match(/^[A-Za-z_][A-Za-z_0-9]*/) as RegExpMatchArray | null
  if (w) {
    const word = w[0]
    const lw = word.toLowerCase()
    if (st.option) return 'option'
    if (first && ODE_KEYWORDS.has(lw)) return 'keyword'
    if (s.match(/^'/)) return 'deriv' // x' (a derivative)
    if (first && /^d[a-z_0-9]+$/i.test(word) && s.match(/^\/dt/i)) return 'deriv'
    if (ODE_FUNCTIONS.has(lw)) return 'function'
    return 'variable'
  }
  if (s.match(/^[-+*/^=<>!&|(),[\]{}]/)) return 'operator'
  s.next()
  return null
}

export function tokenXps(s: Stream, st: TokState): Tok {
  if (s.sol()) st.lineStart = true
  if (s.eatSpace()) return null
  const first = st.lineStart
  st.lineStart = false
  if (s.match(/^#.*/)) return 'comment'
  if (s.match(/^"(?:[^"\\]|\\.)*"?/)) return 'string'
  if (s.match(/^\$\{?[A-Za-z_][A-Za-z_0-9]*\}?/)) return 'variable'
  if (s.match(/^-?[0-9]*\.?[0-9]+(?:e[-+]?[0-9]+)?/i)) return 'number'
  const w = s.match(/^[A-Za-z_][A-Za-z_0-9.]*/) as RegExpMatchArray | null
  if (w) {
    if (first && XPS_COMMANDS.has(w[0].toLowerCase())) return 'command'
    return null
  }
  if (s.match(/^[=;|:]/)) return 'operator'
  s.next()
  return null
}

/** a Stream over one line, for Monaco */
export class LineStream implements Stream {
  pos = 0
  start = 0
  line: string
  constructor(line: string) {
    this.line = line
  }
  sol() {
    return this.pos === 0
  }
  eol() {
    return this.pos >= this.line.length
  }
  peek() {
    return this.line[this.pos]
  }
  next() {
    return this.line[this.pos++]
  }
  match(re: RegExp) {
    const m = this.line.slice(this.pos).match(re)
    if (!m || m.index !== 0) return null
    this.pos += m[0].length
    return m
  }
  skipToEnd() {
    this.pos = this.line.length
  }
  eatSpace() {
    const m = this.line.slice(this.pos).match(/^\s+/)
    if (!m) return false
    this.pos += m[0].length
    return true
  }
  current() {
    return this.line.slice(this.start, this.pos)
  }
}

/** which language a file is in */
export function languageOf(name: string): 'ode' | 'xps' | 'plain' {
  const n = name.toLowerCase()
  if (n.endsWith('.ode')) return 'ode'
  if (n.endsWith('.xps')) return 'xps'
  return 'plain'
}
