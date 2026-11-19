// The model's settings (@ options) as broad, spoken-level commands for the
// .ode editor: "change the integration method to stiff", "increase maximum
// storage to 100000", "x range minus 2 to 2". Pure (also run by Node).
// The options are the ones .ode files use most (counted over a corpus of
// 2,467 public .ode files: total, meth, xhi/xlo/yhi/ylo, dt, bound, xp/yp,
// tol/atol, maxstor, delay, then AUTO's parmin/parmax, ds/dsmin/dsmax, nmax,
// npr, ntst and its axes, bell, nout, dtmax/dtmin, t0, trans...).

export type OptKind = 'number' | 'int' | 'method' | 'name' | 'onoff'
export interface OptDef {
  /** how XPP writes it in an @ line */
  key: string
  /** how it may be said (the first is shown in help) */
  say: string[]
  kind: OptKind
  /** for help: run, graph, AUTO */
  group: 'run' | 'graph' | 'auto'
  what: string
}

export const OPTIONS: OptDef[] = [
  { key: 'total', say: ['total time', 'total', 'integration time', 'end time', 'run time'], kind: 'number', group: 'run', what: 'how long to integrate' },
  { key: 'meth', say: ['integration method', 'method', 'solver', 'integrator', 'numerical method'], kind: 'method', group: 'run', what: 'integration method' },
  { key: 'dt', say: ['time step', 'dt', 'd t', 'delta t', 'step size'], kind: 'number', group: 'run', what: 'time step' },
  { key: 'bound', say: ['bounds', 'bound', 'blow up bound'], kind: 'number', group: 'run', what: 'stop when a variable exceeds this' },
  { key: 'maxstor', say: ['maximum storage', 'max storage', 'storage', 'max store', 'maximum store', 'storage size'], kind: 'int', group: 'run', what: 'rows of data kept' },
  { key: 'tol', say: ['tolerance', 'relative tolerance', 'tol', 'error tolerance'], kind: 'number', group: 'run', what: 'adaptive methods: relative tolerance' },
  { key: 'atol', say: ['absolute tolerance', 'abs tolerance', 'a tol'], kind: 'number', group: 'run', what: 'adaptive methods: absolute tolerance' },
  { key: 'delay', say: ['maximum delay', 'max delay', 'delay'], kind: 'number', group: 'run', what: 'longest delay (delay equations)' },
  { key: 'nout', say: ['output every', 'n out', 'plot every', 'output step', 'save every'], kind: 'int', group: 'run', what: 'keep every n-th step' },
  { key: 'dtmin', say: ['minimum step', 'min step', 'minimum time step', 'dt min', 'smallest step'], kind: 'number', group: 'run', what: 'adaptive methods: smallest step' },
  { key: 'dtmax', say: ['maximum step', 'max step', 'maximum time step', 'dt max', 'largest step'], kind: 'number', group: 'run', what: 'adaptive methods: largest step' },
  { key: 't0', say: ['start time', 'initial time', 't zero', 'starting time'], kind: 'number', group: 'run', what: 'starting time' },
  { key: 'trans', say: ['transient', 'transient time', 'skip time'], kind: 'number', group: 'run', what: 'time not plotted at the start' },
  { key: 'nmesh', say: ['nullcline mesh', 'mesh', 'nullcline grid'], kind: 'int', group: 'run', what: 'nullcline grid size' },
  { key: 'seed', say: ['random seed', 'seed'], kind: 'int', group: 'run', what: 'random number seed' },
  { key: 'xlo', say: ['x low', 'x min', 'x minimum', 'x lower limit', 'x from'], kind: 'number', group: 'graph', what: 'graph: left edge' },
  { key: 'xhi', say: ['x high', 'x max', 'x maximum', 'x upper limit'], kind: 'number', group: 'graph', what: 'graph: right edge' },
  { key: 'ylo', say: ['y low', 'y min', 'y minimum', 'y lower limit', 'y from'], kind: 'number', group: 'graph', what: 'graph: bottom' },
  { key: 'yhi', say: ['y high', 'y max', 'y maximum', 'y upper limit'], kind: 'number', group: 'graph', what: 'graph: top' },
  { key: 'xp', say: ['x axis', 'x axis variable', 'horizontal axis', 'x variable'], kind: 'name', group: 'graph', what: 'graph: variable across' },
  { key: 'yp', say: ['y axis', 'y axis variable', 'vertical axis', 'y variable'], kind: 'name', group: 'graph', what: 'graph: variable up' },
  { key: 'bell', say: ['bell', 'sound', 'beep'], kind: 'onoff', group: 'graph', what: 'the bell' },
  { key: 'parmin', say: ['parameter min', 'parameter minimum', 'par min', 'auto parameter min', 'parameter lower limit'], kind: 'number', group: 'auto', what: 'AUTO: lowest parameter value' },
  { key: 'parmax', say: ['parameter max', 'parameter maximum', 'par max', 'auto parameter max', 'parameter upper limit'], kind: 'number', group: 'auto', what: 'AUTO: highest parameter value' },
  { key: 'ds', say: ['auto step', 'd s', 'arc length step', 'continuation step'], kind: 'number', group: 'auto', what: 'AUTO: step along the branch' },
  { key: 'dsmin', say: ['d s min', 'minimum auto step', 'smallest auto step', 'min auto step'], kind: 'number', group: 'auto', what: 'AUTO: smallest step' },
  { key: 'dsmax', say: ['d s max', 'maximum auto step', 'largest auto step', 'max auto step'], kind: 'number', group: 'auto', what: 'AUTO: largest step' },
  { key: 'nmax', say: ['n max', 'maximum number of steps', 'max steps', 'number of steps', 'auto steps'], kind: 'int', group: 'auto', what: 'AUTO: most steps per branch' },
  { key: 'npr', say: ['n p r', 'print every', 'auto output every'], kind: 'int', group: 'auto', what: 'AUTO: save every n-th point' },
  { key: 'ntst', say: ['n t s t', 'mesh intervals', 'number of mesh intervals', 'mesh points'], kind: 'int', group: 'auto', what: 'AUTO: mesh intervals (periodic orbits)' },
  { key: 'autoxmin', say: ['auto x min', 'bifurcation x min'], kind: 'number', group: 'auto', what: 'AUTO graph: left edge' },
  { key: 'autoxmax', say: ['auto x max', 'bifurcation x max'], kind: 'number', group: 'auto', what: 'AUTO graph: right edge' },
  { key: 'autoymin', say: ['auto y min', 'bifurcation y min'], kind: 'number', group: 'auto', what: 'AUTO graph: bottom' },
  { key: 'autoymax', say: ['auto y max', 'bifurcation y max'], kind: 'number', group: 'auto', what: 'AUTO graph: top' },
]

/** integration methods: how they are said, and the value written (XPP reads its first character) */
export const METHOD_VALUES: Array<[string[], string, string]> = [
  [['runge kutta', 'r k', 'r k four', 'rk four', 'fourth order runge kutta'], 'rungekutta', 'Runge-Kutta'],
  [['euler'], 'euler', 'Euler'],
  [['modified euler', 'mod euler', 'improved euler'], 'modeuler', 'Mod. Euler'],
  [['discrete', 'map', 'difference equation'], 'discrete', 'Discrete'],
  [['adams', 'adams bashforth'], 'adams', 'Adams'],
  [['gear'], 'gear', 'Gear'],
  [['stiff'], 'stiff', 'Stiff'],
  [['cvode', 'c vode'], 'cvode', 'CVode'],
  [['dormand prince', 'dopri', 'dormand prince five', 'dopri five'], '5dp', 'DoPri(5)'],
  [['dormand prince eight', 'dopri eight'], '83dp', 'DoPri(8)'],
  [['rosenbrock', 'rosen'], '2rb', 'Rosen(2)'],
  [['backward euler', 'back euler'], 'backeul', 'BackEul'],
  [['qualitative runge kutta', 'qual r k', 'adaptive runge kutta'], 'qualrk', 'QualRK4'],
  [['volterra'], 'volterra', 'Volterra'],
  [['symplectic'], 'ymp', 'Symplectic'],
]

// XPP's own option names in the order it tries them (load_eqn.c set_option):
// a name in a file belongs to the first of these it starts with
const XPP_ORDER = ('LOGFILE BELL BUT BIGFONT BIG SMALLFONT SMALL FORECOLOR BACKCOLOR MWCOLOR DWCOLOR GRADS PLOTFMT ' +
  'BACKIMAGE WIDTH HEIGHT YNC XNC SMC UMC LT SEED BACK COLORMAP NPLOT SIMPLOT MULTIWIN XP YP ZP AXES NJMP NOUT ' +
  'NMESH METH VMAXPTS MAXSTOR FOLD TOTAL DTMIN DTMAX DT T0 TRANS BOUND ATOL TOL DELAY BANDUP BANDLO PHI THETA ' +
  'XLO YLO XHI YHI XMAX YMAX ZMAX XMIN YMIN ZMIN POIMAP').split(' ')

/** which option a name written in a file sets ("method" -> meth, "dtmin" -> dtmin) */
export function optionOf(written: string): string {
  const u = written.toUpperCase()
  const k = XPP_ORDER.find((o) => u.startsWith(o))
  return k ? (k === 'NJMP' ? 'nout' : k.toLowerCase()) : written.toLowerCase()
}

/** a value as it is written in the file */
export function formatValue(kind: OptKind, v: number | string): string {
  if (kind === 'onoff') return v ? '1' : '0'
  if (typeof v === 'string') return v
  if (kind === 'int') return String(Math.round(v))
  return String(+v.toPrecision(12))
}

/**
 * Set @ options in an .ode text. An option already set is changed where it is
 * (its spelling kept); a new one goes on an @ line of its own after the last
 * @ line (or before "done"). Returns the new text, the line changed (0-based)
 * and the old values.
 */
export function setOptions(text: string, pairs: Array<[string, string]>): { text: string; line: number; old: Record<string, string> } {
  const lines = text.split('\n')
  const old: Record<string, string> = {}
  let line = -1
  const missing: string[] = []
  for (const [key, value] of pairs) {
    let done = false
    for (let i = 0; i < lines.length && !done; i++) {
      const raw = lines[i]
      const hash = raw.indexOf('#')
      const code = hash >= 0 ? raw.slice(0, hash) : raw
      if (!code.trimStart().startsWith('@')) continue
      // name=value pieces as XPP cuts them (at spaces and commas)
      const re = /([A-Za-z_][\w]*)=([^\s,]*)/g
      for (let m; (m = re.exec(code)); ) {
        if (optionOf(m[1]) !== key) continue
        old[key] = m[2]
        // "@total=15": XPP skips the piece glued to the @, so add the space
        const glued = code.slice(0, m.index).trimEnd().endsWith('@') && !/\s$/.test(code.slice(0, m.index))
        lines[i] = raw.slice(0, m.index) + `${glued ? ' ' : ''}${m[1]}=${value}` + raw.slice(m.index + m[0].length)
        line = i
        done = true
        break
      }
    }
    if (!done) missing.push(`${key}=${value}`)
  }
  if (missing.length) {
    // one new @ line: after the last @ line, else before "done", else at the end
    let at = -1
    lines.forEach((l, i) => {
      if (l.trimStart().startsWith('@')) at = i + 1
    })
    if (at < 0) {
      const d = lines.findIndex((l) => /^\s*d[a-z]*\s*(#.*)?$/i.test(l))
      at = d >= 0 ? d : lines.length
      // no trailing empty line after the end
      if (d < 0 && lines.length && lines[lines.length - 1] === '') at = lines.length - 1
    }
    lines.splice(at, 0, `@ ${missing.join(', ')}`)
    line = at
  }
  return { text: lines.join('\n'), line, old }
}

/**
 * Change a parameter's, constant's or initial value's number where the file
 * declares it ("par gk=25" -> "par gk=50", "init v=0", "number c=2",
 * "v(0)=1"). Null when the file does not declare `name` that way.
 */
export function setDeclared(text: string, name: string, value: string): { text: string; line: number; old: string } | null {
  const lines = text.split('\n')
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const hash = raw.indexOf('#')
    const code = hash >= 0 ? raw.slice(0, hash) : raw
    // XPP knows a keyword by its first letter: p(ar), i(nit), n(umber)
    const kw = code.match(/^\s*([pin][a-z]*)\s+/i)
    if (kw) {
      const m = new RegExp(`(^|[\\s,])(${n})(\\s*=\\s*)([^\\s,]+)`, 'i').exec(code.slice(kw[0].length))
      if (m) {
        const at = kw[0].length + m.index + m[1].length + m[2].length + m[3].length
        lines[i] = raw.slice(0, at) + value + raw.slice(at + m[4].length)
        return { text: lines.join('\n'), line: i, old: m[4] }
      }
    }
    // v(0)=1
    const ic = new RegExp(`^(\\s*${n}\\s*\\(\\s*0\\s*\\)\\s*=\\s*)([^\\s,]+)`, 'i').exec(code)
    if (ic) {
      lines[i] = ic[1] + value + raw.slice(ic[0].length)
      return { text: lines.join('\n'), line: i, old: ic[2] }
    }
  }
  return null
}
