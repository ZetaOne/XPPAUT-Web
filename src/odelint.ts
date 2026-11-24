// Reading XPP's verdict on an .ode file. XPP itself is the judge: its error
// messages, its "option not recognized" notes, and the parameter and
// initial values it actually read (-qpars / -qics) compared with what the
// text says. This file only finds the lines and words the messages are
// about. No browser code here: the corpus test (scripts/odecheck-corpus.mjs)
// runs exactly this under Node.

export interface Issue {
  line: number // 0-based; -1 when the line could not be found
  severity: 'error' | 'warning'
  message: string
}

/** what XPP printed while reading the file, and what it read */
export interface XppReport {
  messages: string[] // XPP's output lines (any run)
  crashed?: boolean // XPP stopped abnormally (no message to go by)
  params?: Map<string, number> // -qpars: NAME (upper case) -> value
  ics?: Map<string, number> // -qics: NAME (upper case) -> value
}

/** names a model defines (for highlighting and completion) */
export interface Names {
  params: Set<string>
  vars: Set<string>
  funcs: Set<string>
  aux: Set<string>
}

/** option names offered for completion (common ones, as usually written) */
export const COMMON_OPTIONS = ['total', 'dt', 'xp', 'yp', 'xlo', 'xhi', 'ylo', 'yhi', 'meth', 'maxstor', 'bounds', 'nout',
  'trans', 'bell', 'axes', 'tol', 'atol', 'dtmin', 'dtmax', 'njmp', 'xplot', 'yplot', 'ntst', 'nmax', 'npr', 'dsmin',
  'dsmax', 'ds', 'parmin', 'parmax', 'autoxmin', 'autoxmax', 'autoymin', 'autoymax', 'output', 'seed']

/** options people put on par lines by mistake */
const OPTION_HINTS = ['meth', 'method', 'total', 'dt', 'xp', 'yp', 'xlo', 'xhi', 'ylo', 'yhi', 'maxstor', 'bounds', 'bound', 'nout', 'trans']

/** XPP's built-in functions and constants */
export const BUILTINS = ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sinh', 'cosh', 'tanh', 'exp', 'ln',
  'log', 'log10', 'sqrt', 'abs', 'heav', 'sign', 'mod', 'flr', 'ran', 'normal', 'besselj', 'bessely', 'besseli',
  'erf', 'erfc', 'max', 'min', 'if', 'then', 'else', 'lgamma', 'delay', 'pi', 't', 'sum', 'of', 'shift', 'del_shft',
  'hom_bcs', 'poisson', 'arg1', 'arg2']

export const KEYWORDS = ['par', 'param', 'init', 'aux', 'number', 'table', 'wiener', 'global', 'markov', 'bdry',
  'done', 'set', 'only', 'export', 'volterra', 'special', 'options']

/** the file as XPP reads it: lines joined at a trailing "\", up to "done" */
function logicalLines(text: string): Array<{ line: number; text: string }> {
  const out: Array<{ line: number; text: string }> = []
  const src = text.split(/\r?\n/)
  for (let i = 0; i < src.length; i++) {
    const start = i
    let s = src[i]
    while (/\\\s*$/.test(s) && i + 1 < src.length) s = s.replace(/\\\s*$/, '') + src[++i]
    out.push({ line: start, text: s })
    // "done" ends the file for XPP; it only looks at the first letter ("d" works)
    if (/^\s*d[a-z]*\s*(#.*)?$/i.test(s)) break
  }
  return out
}

/** a declaration line ("par a=1, b=2", "init x=0", "number n=3")? its keyword letter */
function declKind(s: string): 'p' | 'i' | 'n' | 'a' | null {
  const t = s.trimStart()
  const m = t.match(/^([a-z]+)\s+(?=[a-z_])/i)
  if (!m) return null
  const k = m[1][0].toLowerCase()
  return k === 'p' || k === 'i' || k === 'n' || k === 'a' ? k : null
}

/** name=value pairs of a declaration line (values as written) */
function pairs(s: string): Array<{ name: string; value: string }> {
  const body = s.trimStart().replace(/^[a-z]+\s+/i, '')
  return [...body.matchAll(/([a-z_][\w]*)\s*=\s*([^\s,]*)/gi)].map((m) => ({ name: m[1], value: m[2] }))
}

const NUM = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/

/** the names a model defines */
export function modelNames(text: string): Names {
  const n: Names = { params: new Set(), vars: new Set(), funcs: new Set(), aux: new Set() }
  for (const { text: raw } of logicalLines(text)) {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line || line[0] === '"' || line[0] === '@') continue
    let m: RegExpMatchArray | null
    if ((m = line.match(/^([a-z_]\w*)(?:\[[^\]]*\])?\s*'\s*=/i)) || (m = line.match(/^d([a-z_]\w*)\s*\/\s*dt\s*=/i)) ||
      (m = line.match(/^([a-z_]\w*)\s*\(\s*t\s*\+\s*1\s*\)\s*=/i))) n.vars.add(m[1])
    else if ((m = line.match(/^([a-z_]\w*)\s*\(([^)]*)\)\s*=/i)) && !/^\s*0\s*$/.test(m[2])) n.funcs.add(m[1])
    else {
      const k = declKind(line)
      if (k === 'p' || k === 'n') for (const p of pairs(line)) n.params.add(p.name)
      else if (k === 'a') for (const p of pairs(line)) n.aux.add(p.name)
      else if (k === 'i') for (const p of pairs(line)) n.vars.add(p.name)
    }
  }
  return n
}

/** where in the file an expression XPP quotes (upper case, no spaces) is */
function findExpr(text: string, expr: string): number {
  const all = expr.replace(/\s+/g, '').toUpperCase()
  if (!all) return -1
  const src = logicalLines(text).map((l) => ({ line: l.line, s: l.text.replace(/#.*$/, '').replace(/\s+/g, '').toUpperCase() }))
  // the whole quote; else its right-hand side (array lines are quoted
  // expanded: "W1_[J]'=..." for "w1_[0..9]'=..."); else a short start of it
  const rhs = all.includes('=') ? all.slice(all.indexOf('=') + 1) : all
  // exact matches first (a short quote like "0*" is in many lines)
  const rhsOf = (x: string) => (x.includes('=') ? x.slice(x.indexOf('=') + 1) : x)
  const exact = src.find((l) => l.s === all || rhsOf(l.s) === rhs)
  if (exact) return exact.line
  for (const want of [all, rhs, rhs.slice(0, 24), rhs.slice(0, 12)]) {
    if (want.length < 3 && want !== all) continue
    const hits = src.filter((l) => l.s.includes(want))
    if (hits.length) return (hits.find((l) => rhsOf(l.s).endsWith(want)) ?? hits[0]).line
  }
  return -1
}

/** the line defining variable / aux / function `name` */
function findDef(text: string, name: string): number {
  const n = name.replace(/'$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pats = [new RegExp(`^\\s*${n}\\s*'\\s*=`, 'i'), new RegExp(`^\\s*d${n}\\s*/\\s*dt\\s*=`, 'i'),
    new RegExp(`^\\s*${n}\\s*\\(`, 'i'), new RegExp(`^\\s*a\\w*\\s.*\\b${n}\\s*=`, 'i'), new RegExp(`^\\s*${n}\\s*=`, 'i')]
  const lines = logicalLines(text)
  for (const p of pats) {
    const hit = lines.find((l) => p.test(l.text))
    if (hit) return hit.line
  }
  return -1
}

/** the line where `name` is defined a second time */
function findSecond(text: string, name: string): number {
  const n = name.toLowerCase().replace(/[':]+$/, '')
  const hits: number[] = []
  for (const { line, text: s } of logicalLines(text)) {
    const t = s.replace(/#.*$/, '').trim().toLowerCase()
    if (!t || t[0] === '"' || t[0] === '@') continue
    const lhs = t.match(/^([a-z_]\w*)\s*(?:'|\(|=)/)?.[1] ?? t.match(/^d([a-z_]\w*)\s*\/\s*dt/)?.[1]
    const decl = declKind(t) ? pairs(t).map((p) => p.name.toLowerCase()) : []
    if (lhs === n || decl.includes(n)) hits.push(line)
  }
  return hits[1] ?? hits[0] ?? nameLine(text, n)
}

/** the @ line mentioning option `name` */
function findOption(text: string, name: string): number {
  const re = new RegExp(`\\b${name.replace(/[^\w]/g, '')}\\s*=`, 'i')
  return logicalLines(text).find((l) => l.text.trimStart().startsWith('@') && re.test(l.text))?.line ?? -1
}

/** did XPP read the file without errors? */
export function xppAccepted(messages: string[]): boolean {
  // a query run (-qpars/-qics) that read the whole file ends with "It's a
  // dry run" (with both of XPP's readers). "All formulas are valid" alone is
  // not enough: XPP can still stop afterwards (e.g. "@ bell=off").
  return messages.some((l) => /It's a dry run/.test(l))
}

/** fallbacks when XPP's quote cannot be found in the file */
const codeLines = (text: string) => logicalLines(text).filter((l) => {
  const t = l.text.trim()
  return t && t[0] !== '#' && t[0] !== '"' && t[0] !== '@'
})
function unbalancedLine(text: string): number {
  for (const { line, text: s } of codeLines(text)) {
    let d = 0
    for (const c of s.replace(/#.*$/, '')) {
      if (c === '(') d++
      else if (c === ')' && --d < 0) break
    }
    if (d !== 0) return line
  }
  return -1
}
function danglingLine(text: string): number {
  return codeLines(text).find((l) => /[-+*/^(,=]\s*$/.test(l.text.replace(/#.*$/, '').trimEnd()))?.line ?? -1
}
function nameLine(text: string, name: string): number {
  const re = new RegExp(`(?<![\\w.])${name.replace(/[^\w]/g, '')}(?!\\w)`, 'i')
  return codeLines(text).find((l) => re.test(l.text.replace(/#.*$/, '')))?.line ?? -1
}
const or = (a: number, b: () => number) => (a >= 0 ? a : b())

/** XPP's error messages -> issues */
function errors(text: string, out: string[], r?: XppReport): Issue[] {
  if (xppAccepted(out)) return []
  if (!codeLines(text).length || out.some((l) => /Must have at least one equation/i.test(l)))
    return [{ line: -1, severity: 'error', message: 'This file has no equations (XPP needs at least one)' }]
  // XPP's size limits: where they are reached is found by cutting the file (see locateCrash)
  const limit = out.join(' ').match(/too many (functions|constants|variables|parameters|tables|equations)/i)
  if (limit) return [{ line: -1, severity: 'error', message: `The model has more ${limit[1].toLowerCase()} than XPP can hold` }]
  const issues: Issue[] = []
  for (let i = 0; i < out.length; i++) {
    const l = out[i].trim()
    let m: RegExpMatchArray | null
    if ((m = l.match(/(?:^|\s)illegal expression:\s*(\S+)/i))) {
      const name = m[1]
      issues.push({ line: or(findExpr(text, out[i + 1] ?? ''), () => nameLine(text, name)), severity: 'error', message: `XPP does not know "${m[1].toLowerCase()}" (a typo, or a name not defined?)` })
    } else if (/(?:^|\s)parentheses don't match/i.test(l)) {
      const def = out.slice(i).find((x) => /ERROR compiling|messed up/i.test(x))?.match(/(?:compiling|Function)\s+(\S+)/i)?.[1]
      issues.push({ line: or(def ? findDef(text, def) : -1, () => unbalancedLine(text)), severity: 'error', message: 'Parentheses do not match' })
    } else if (/(?:^|\s)Premature end of expression/i.test(l)) {
      issues.push({ line: or(findExpr(text, out[i + 1] ?? ''), () => danglingLine(text)), severity: 'error', message: 'The expression ends too early (something missing after an operator?)' })
    } else if ((m = l.match(/(?:^|\s)Function (\S+) messed up/i))) {
      if (!issues.length) issues.push({ line: findDef(text, m[1]), severity: 'error', message: `XPP cannot read the function ${m[1].toLowerCase()}` })
    } else if ((m = l.match(/(?:^|\s)ERROR compiling\s+(\S+)/i))) {
      if (!issues.length) issues.push({ line: findDef(text, m[1]), severity: 'error', message: `XPP cannot read the formula for ${m[1].toLowerCase()}` })
    } else if ((m = l.match(/(?:^|\s)Error in parsing\s+(.*)$/i))) {
      issues.push({ line: findExpr(text, m[1]), severity: 'error', message: 'XPP cannot read this line' })
    } else if ((m = l.match(/(?:^|\s)(\S+) is a duplicate name/i))) {
      if (!issues.some((x) => x.message.includes('twice'))) {
        const name = m[1].toLowerCase().replace(/[':]+$/, '')
        // "par a =   # comment": with no value, XPP reads the comment's words as names
        const inComment = codeLines(text).filter((x) => declKind(x.text) && new RegExp(`#.*\\b${name.replace(/[^\w]/g, '')}\\b`, 'i').test(x.text) && /=\s*#/.test(x.text))
        issues.push(inComment.length
          ? { line: inComment[inComment.length - 1].line, severity: 'error', message: `No value after "=": XPP reads the comment's words as names, so "${name}" is defined twice. Write a value, e.g. "= 0"` }
          : { line: findSecond(text, m[1]), severity: 'error', message: `"${name}" is defined twice` })
      }
    } else if ((m = l.match(/Error in (?!parsing)(.+?)(?:\s{2,}(.*))?$/))) {
      // "Error in <formula>  <reason>" (the reason may be on the next line)
      const why = (m[2] || out[i + 1] || '').trim()
      issues.push({ line: findExpr(text, m[1].slice(0, 40)), severity: 'error', message: 'XPP cannot read this formula' + (why ? ': ' + why.replace(/\s+/g, ' ') : '') })
    } else if ((m = l.match(/Problem with creating table.*ERROR computing\s+(\S+)/i) ?? (/Problem with creating table/i.test(l) ? (out[i + 1] ?? '').match(/ERROR computing\s+(\S+)/i) : null))) {
      const tname = m[1]
      const at = logicalLines(text).find((x) => new RegExp(`^\\s*t\\w*\\s+${tname.replace(/[^\w]/g, '')}\\b`, 'i').test(x.text))
      const file = at && /^\s*t\w*\s+\S+\s+(?!%)\S/.test(at.text) && !/%/.test(at.text)
      issues.push({ line: at?.line ?? -1, severity: 'error', message: `XPP could not make the table ${tname.toLowerCase()}` + (file ? ' (is its .tab file next to the model?)' : ' (check its formula and range)') })
    } else if ((m = l.match(/Loading new options file:<([^>]*)>/i)) && !out.slice(i + 1).some((x) => /All formulas|dry run/.test(x))) {
      issues.push({ line: logicalLines(text).find((x) => /^\s*o\w*\s+\S/i.test(x.text))?.line ?? -1, severity: 'error', message: `XPP could not use the options file ${m[1]} (is it next to the model?)` })
    } else if ((m = l.match(/Error allocating or compiling\s+(\S+)/i))) {
      const what = m[1]
      issues.push({ line: or(findDef(text, what), () => nameLine(text, what)), severity: 'error', message: `XPP cannot read the formula for ${what.toLowerCase()}` })
    } else if ((m = l.match(/(\w+) option must be 0 or 1/i))) {
      issues.push({ line: findOption(text, m[1]), severity: 'error', message: `"${m[1].toLowerCase()}" must be 0 or 1: XPP stops here` })
    } else if (/Cant export/i.test(l)) {
      issues.push({ line: logicalLines(text).find((x) => /^\s*e\w*\s/i.test(x.text))?.line ?? -1, severity: 'error', message: 'export names something that does not exist' })
    }
  }
  // Volterra integrals (int{...}, int[...]): XPP's messages about them do not
  // quote the line; point at the integral
  const conv = codeLines(text).filter((l) => /\bint\s*[{[]/i.test(l.text))
  if (conv.length && (issues.every((x) => x.line < 0) || out.some((l) => /convolution/i.test(l))))
    for (const x of issues.length ? issues : [])
      if (x.line < 0) x.line = conv[0].line
  if (out.some((l) => /Illegal convolution/i.test(l)) && conv.length && !issues.some((x) => x.line >= 0))
    issues.push({ line: conv[0].line, severity: 'error', message: 'XPP cannot read this integral (int{...}): check the names and formula inside it' })
  if (!issues.length && !codeLines(text).length) issues.push({ line: -1, severity: 'error', message: 'This file has no equations' })
  if (!issues.length && r?.crashed) issues.push({ line: -1, severity: 'error', message: 'XPP stopped unexpectedly while reading this file' })
  if (!issues.length) {
    // something else stopped XPP: show its last words
    const last = out.filter((l) => l.trim() && !/Copyright|dry run/i.test(l)).slice(-2).join(' ')
    issues.push({ line: -1, severity: 'error', message: 'XPP could not read the file' + (last ? ': ' + last.trim() : '') })
  }
  return issues
}

/** what XPP read differs from what the text says (values, options) */
function misreadings(text: string, r: XppReport): Issue[] {
  const issues: Issue[] = []
  for (const l of r.messages) {
    const m = l.match(/Option\s+(\S+)\s+not recognized/i)
    if (m) issues.push({ line: findOption(text, m[1]), severity: 'warning', message: `XPP does not know the option "${m[1].toLowerCase()}" and ignores it` })
  }
  // XPP cuts an @ line at spaces and commas, throws the first piece away (the
  // "@") and keeps only pieces of the form name=value: "@total=10" and
  // "total = 10" are silently ignored (checked against XPP)
  text.split('\n').forEach((raw, line) => {
    const s = raw.replace(/#.*$/, '').trimStart()
    if (!s.startsWith('@')) return
    const parts = s.split(/[ ,\r]+/).filter(Boolean)
    if (parts[0].length > 1 && parts[0].includes('='))
      issues.push({ line, severity: 'warning', message: `XPP ignores "${parts[0].slice(1)}": put a space after the @` })
    const loose = parts.slice(1).filter((p) => p !== '@' && !/^[^=]+=[^=]/.test(p))
    if (loose.some((p) => p.startsWith('=') || p.endsWith('=')))
      issues.push({ line, severity: 'warning', message: 'XPP ignores options written with spaces around "=": write name=value' })
    else if (loose.length)
      issues.push({ line, severity: 'warning', message: `XPP ignores "${loose.join(' ')}": options are name=value (comments go after #)` })
  })
  for (const { line, text: s } of logicalLines(text)) {
    const k = declKind(s.replace(/#.*$/, ''))
    const table = k === 'p' || k === 'n' ? r.params : k === 'i' ? r.ics : undefined
    if (!table) continue
    for (const p of pairs(s.replace(/#.*$/, ''))) {
      const got = table.get(p.name.toUpperCase())
      // "1.0[0,2]": a value with a slider range (XPP reads the number)
      const value = p.value.replace(/\[[^\]]*\]?$/, '')
      if (got === undefined || NUM.test(value)) continue
      // what the text means, with the values XPP read for the model's names
      const meant = evaluate(value.replace(/;+$/, ''), (n) => r.params?.get(n) ?? r.ics?.get(n))
      if (meant !== undefined && same(meant, got)) continue
      const opt = (k === 'p' || k === 'n') && OPTION_HINTS.includes(p.name.toLowerCase())
      issues.push({
        line, severity: 'warning',
        message: opt
          ? `"${p.name}" is an option: write it on an @ line ("@ ${p.name}=${p.value}"); here XPP makes it a parameter = ${fmt(got)}`
          : meant !== undefined
          ? `"${p.name}=${p.value}": XPP does not calculate formulas here; it uses ${fmt(got)}, not ${fmt(meant)}`
          : `"${p.name}=${p.value}": XPP needs a number here and uses ${fmt(got)}`,
      })
    }
  }
  return issues
}

/** XPP prints values with 6 decimals ("%f"): equal at that precision */
function same(a: number, b: number): boolean {
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.isNaN(a) && Number.isNaN(b)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b
  return Math.abs(a - b) <= 5e-7 + 1e-6 * Math.max(Math.abs(a), Math.abs(b))
}

const fmt = (v: number) => (Number.isFinite(v) ? String(+v.toPrecision(6)) : String(v))

/**
 * The value of a simple formula (numbers, names, + - * / ^, parentheses);
 * undefined when it uses anything else or an unknown name.
 */
export function evaluate(expr: string, name: (n: string) => number | undefined): number | undefined {
  const toks = expr.match(/\d*\.?\d+(?:[eE][-+]?\d+)?\.?|[A-Za-z_]\w*|\*\*|[-+*/^()]|\S/g) ?? []
  let i = 0
  const peek = () => toks[i]
  const prim = (): number | undefined => {
    const t = toks[i++]
    if (t === undefined) return undefined
    if (t === '(') {
      const v = sum()
      return toks[i++] === ')' ? v : undefined
    }
    if (t === '-') { const v = pow(); return v === undefined ? v : -v }
    if (t === '+') return pow()
    if (/^[\d.]/.test(t)) return NUM.test(t.replace(/\.$/, '')) ? Number(t.replace(/\.$/, '')) : undefined
    if (/^[A-Za-z_]/.test(t)) {
      const u = t.toUpperCase()
      if (u === 'PI') return Math.PI
      if (u === 'INF') return Infinity
      if (u === 'NAN') return NaN
      return peek() === '(' ? undefined : name(u)
    }
    return undefined
  }
  const pow = (): number | undefined => {
    const a = prim()
    if (peek() === '^' || peek() === '**') {
      i++
      const b = pow()
      return a === undefined || b === undefined ? undefined : a ** b
    }
    return a
  }
  const prod = (): number | undefined => {
    let a = pow()
    while (peek() === '*' || peek() === '/') {
      const op = toks[i++]
      const b = pow()
      if (a === undefined || b === undefined) return undefined
      a = op === '*' ? a * b : a / b
    }
    return a
  }
  const sum = (): number | undefined => {
    let a = prod()
    while (peek() === '+' || peek() === '-') {
      const op = toks[i++]
      const b = prod()
      if (a === undefined || b === undefined) return undefined
      a = op === '+' ? a + b : a - b
    }
    return a
  }
  const v = sum()
  return i === toks.length ? v : undefined
}

/** XPP's list output ("a 2.000000" lines after a "#... query:" header) */
export function readQuery(file: string): Map<string, number> {
  const m = new Map<string, number>()
  for (const l of file.split('\n')) {
    const p = l.trim().split(/\s+/)
    if (p.length === 2 && !l.startsWith('#')) {
      const v = p[1].toLowerCase()
      m.set(p[0].toUpperCase(), /^[-+]?inf/.test(v) ? (v[0] === '-' ? -Infinity : Infinity) : /nan/.test(v) ? NaN : Number(p[1]))
    }
  }
  return m
}

/**
 * Where XPP crashes: the first line k such that the file cut after line k
 * (plus "done") still crashes it. Cutting a file causes ordinary errors
 * (names defined later), not crashes, so the search is reliable for crashes.
 */
export async function locateCrash(text: string, crashes: (t: string) => Promise<boolean>): Promise<number> {
  return locateFailure(text, crashes)
}

/** the same search for any failure that cutting the file cannot cause (crashes, XPP's size limits) */
export async function locateFailure(text: string, crashes: (t: string) => Promise<boolean>): Promise<number> {
  const src = text.split(/\r?\n/)
  const cut = (k: number) => src.slice(0, k + 1).join('\n') + '\ndone\n'
  let lo = -1 // the file up to lo does not crash (empty: no)
  let hi = src.length - 1 // up to hi crashes
  if (!(await crashes(cut(hi)))) return -1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (await crashes(cut(mid))) hi = mid
    else lo = mid
  }
  return hi
}

/** one XPP run: its messages, the query file it wrote, whether it crashed */
export interface Run {
  messages: string[]
  query: string
  crashed?: boolean
}

/**
 * For failures that cutting the file cannot cause, a test telling whether
 * another run fails the same way (used to find the line by bisection).
 */
function sameFailure(r: Run): ((r2: Run) => boolean) | null {
  if (r.crashed) return (r2) => !!r2.crashed
  const all = r.messages.join(' ')
  const key = all.match(/too many \w+/i)?.[0] ?? all.match(/\S+ is a duplicate name/i)?.[0] ?? all.match(/\w+ option must be 0 or 1/i)?.[0]
  return key ? (r2) => r2.messages.join(' ').includes(key) : null
}

/**
 * The whole check: `run` runs XPP on a text with -qpars or -qics (the app
 * uses the WebAssembly build, the corpus test the desktop build).
 */
export async function checkWith(text: string, run0: (t: string, flag: '-qpars' | '-qics') => Promise<Run>): Promise<Issue[]> {
  // "@ output=file" makes XPP write its query lists there instead of where
  // we ask: in the copy XPP checks, make it a harmless option (same line)
  const probe = (t: string) => t.replace(/^@.*$/gm, (l) => l.replace(/\boutput\w*\s*=\s*[^,\s]+/gi, 'seed=0'))
  const run = (t: string, flag: '-qpars' | '-qics') => run0(probe(t), flag)
  const p = await run(text, '-qpars')
  if (!xppAccepted(p.messages)) {
    const issues = analyze(text, { messages: p.messages, crashed: p.crashed })
    const same = sameFailure(p)
    if (same && issues.length) {
      const line = await locateFailure(text, async (t) => same(await run(t, '-qpars')))
      if (line >= 0) issues[0] = { ...issues[0], line, message: p.crashed ? 'XPP stops (crashes) when it reads this line' : issues[0].message }
    }
    return issues
  }
  const i = await run(text, '-qics')
  return analyze(text, { messages: [...p.messages, ...i.messages], params: readQuery(p.query), ics: readQuery(i.query) })
}

/** all issues for `text`, from what XPP reported */
export function analyze(text: string, r: XppReport): Issue[] {
  const e = errors(text, r.messages, r)
  return e.length ? e : misreadings(text, r)
}
