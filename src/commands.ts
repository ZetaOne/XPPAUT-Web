// Every XPP command as the keys that reach it: XPP's menus answer to the
// capital letter of each entry (Window/zoom -> Fit is "w f"). Taken from the
// menu tables in xppaut/menudrive.c, numerics.c and auto_nox.c. Used by the
// Cmd panel (src/mobile.ts) and the command list (src/cmdlib.ts).

export interface XppCommand {
  /** what the button says */
  label: string
  /** keys separated by spaces: letters, or Esc, Enter, Tab, Left, Right, Up, Down */
  keys: string
  group: string
  /** keys go to the AUTO window instead of XPP's main window */
  to?: 'auto'
  /** XPP then asks for a value on its command line: open the keyboard */
  typing?: boolean
  /** a hint shown after it runs */
  tip?: string
  /** switch the Cmd panel to this page (the Numerics menu stays open in XPP) */
  page?: 'numerics'
}

type Opts = Partial<Pick<XppCommand, 'to' | 'page'>>

/** "k:Label|k:Label*" -> commands; a trailing * marks entries that ask for a value */
function menu(group: string, prefix: string, list: string, opts: Opts = {}): XppCommand[] {
  return list.split('|').map((item) => {
    const i = item.indexOf(':')
    let label = item.slice(i + 1)
    const typing = label.endsWith('*')
    if (typing) label = label.slice(0, -1)
    const keys = [...prefix.split(' ').filter(Boolean), ...item.slice(0, i).split('')].join(' ')
    return { label, keys, group, ...(typing ? { typing } : {}), ...opts }
  })
}

const TAP_START = 'Tap the graph to start a trajectory there, as often as you like. Esc (or Back) ends.'

export const COMMANDS: XppCommand[] = [
  // ---- main menu, single keys
  { label: 'Continue', keys: 'c', group: 'Run', typing: true },
  { label: 'Parameters', keys: 'p', group: 'Run', typing: true },
  { label: 'Erase', keys: 'e', group: 'View' },
  { label: 'Restore', keys: 'r', group: 'View' },
  { label: 'Xi vs t', keys: 'x', group: 'View', typing: true },
  { label: '3D parameters', keys: '3', group: 'View' },
  ...menu('Initial conditions', 'i',
    'g:Integrate|l:Last|o:Old|n:New ICs|m:Mouse IC|i:Tap to start|s:Shift|b:Backward|' +
    'r:Range over a parameter|2:Range over 2 parameters|h:Shoot|f:ICs from file|u:Formula|d:DAE guess'),
  ...menu('Nullclines', 'n', 'n:Nullclines|r:Redraw nullclines|a:Auto redraw|m:Manual redraw|s:Save nullclines'),
  ...menu('Nullclines', 'n f', 'f:Freeze nullclines|d:Delete frozen nullclines|r:Range freeze|a:Animate nullclines'),
  ...menu('Direction field', 'd', 'd:Direction field|f:Flow|n:No direction field|c:Colorize|s:Scaled direction field'),
  ...menu('Window/zoom', 'w', 'f:Fit window|z:Zoom in|o:Zoom out|d:Default window|w:Set window|s:Scroll'),
  ...menu('Phase space', 'a', 'a:All variables periodic|n:No periodic variables|c:Choose periodic variables'),
  ...menu('Kinescope', 'k', 'c:Capture|r:Reset|p:Playback|a:Autoplay|s:Save frames|m:Make animated GIF'),
  ...menu('Graphics', 'g', 'a:Add curve|d:Delete last curve|r:Remove all curves|e:Edit curve|p:PostScript|v:SVG|x:Axes options|o:Export data'),
  ...menu('Freeze curves', 'g f', 'f:Freeze curve|d:Delete frozen curve|e:Edit frozen curve|r:Remove all frozen|k:Key|b:Import bif. diagram|c:Clear bif. diagram|o:Auto freeze on/off'),
  ...menu('Colormap', 'g c', 'n:Normal|p:Periodic|h:Hot|c:Cool|b:Blue-red|g:Gray|u:Cubehelix'),
  ...menu('Sing pts', 's', 'g:Sing pts|m:Fixed point here|r:Range|c:Monte Carlo'),
  ...menu('View axes', 'v', '2:2D view|3:3D view|a:Array plot|t:Animation (toon)'),
  ...menu('Make window', 'm', 'c:Create window|k:Kill all windows|d:Destroy window|b:Window to bottom|a:Auto redraw|m:Manual redraw|s:Simultaneous plot'),
  ...menu('Text, markers', 't', 't:Text|a:Arrow|p:Pointer|m:Marker|d:Delete all|s:Markers from data'),
  ...menu('Text, markers', 't e', 'm:Move item|c:Change item|d:Delete item'),
  ...menu('Boundary value', 'b', 'r:BVP range|n:BVP no show|s:BVP show|p:BVP periodic'),
  ...menu('File', 'f', 'a:AUTO|c:Calculator|h:Help|w:Write set|r:Read set|g:Get par set|p:Print source|s:Save info|' +
    't:Transpose|l:Clone|x:.xpprc|b:Bell on/off|i:Tips on/off|u:Tutorial|q:Quit'),
  ...menu('Edit equations', 'f e', 'r:Edit RHS|f:Edit functions|s:Save as'),
  // ---- Numerics (XPP stays in its Numerics menu: the Cmd panel shows that page)
  ...menu('Numerics', 'u', 't:Total*|s:Start time*|r:Transient*|d:Dt*|o:nOutput*|b:Bounds*|e:Delay*|' +
    'n:Nullcline mesh|i:Sing pt control|u:Ruelle plot|v:BVP numerics|m:Method', { page: 'numerics' }),
  ...menu('Method', 'u m', 'r:Runge-Kutta|q:Qualst. RK4 (adaptive)|5:Dormand-Prince 5|8:Dormand-Prince 8(3)|g:Gear|c:CVODE|' +
    's:Stiff|2:Rosenbrock 2(3)|b:Backward Euler|a:Adams|m:Modified Euler|e:Euler|d:Discrete|v:Volterra|y:Symplectic', { page: 'numerics' }),
  ...menu('Color code', 'u c', 'n:No color|v:Color by velocity|a:Color by another quantity', { page: 'numerics' }),
  ...menu('Poincaré map', 'u p', 'n:Map off|s:Section|m:Max/min|p:Period', { page: 'numerics' }),
  ...menu('Stochastic, data', 'u h', 'n:New seed|c:Compute (many runs)|d:Data|m:Mean|v:Variance|h:Histogram|o:Old histogram|' +
    'f:Fourier|p:Power spectrum|i:Fit data|s:Statistics|l:Liapunov exponent|a:Autocorrelation|x:Cross-correlation|e:Spectral density|2:2D histogram', { page: 'numerics' }),
  ...menu('Lookup tables', 'u k', 'e:Edit table|v:View table', { page: 'numerics' }),
  ...menu('Averaging', 'u a', 'n:New adjoint|m:Make H|a:Load adjoint|o:Load orbit|h:Load H function|p:Adjoint parameters|r:Adjoint range', { page: 'numerics' }),
  // ---- the AUTO window
  ...menu('AUTO', '', 'r:Run|g:Grab|p:Parameter|n:AUTO numerics|u:Usr period|c:Clear|d:reDraw', { to: 'auto' }),
  ...menu('AUTO run (from the start)', 'r', 's:Run steady state|p:Run periodic|b:Run boundary value|h:Run homoclinic|e:Run heteroclinic', { to: 'auto' }),
  ...menu('AUTO axes', 'a', 'h:Hi|n:Norm|i:Hi-lo|p:Period|t:Two par|z:Zoom in|o:Zoom out|1:Last 1 par|2:Last 2 par|f:Fit|' +
    'r:Frequency|a:Average|d:Default|s:Scroll', { to: 'auto' }),
  ...menu('AUTO file', 'f', 'i:Import orbit|s:Save diagram|l:Load diagram|p:PostScript|v:SVG|r:Reset diagram|c:Clear grab|' +
    'w:Write points|a:All info|d:Init data|t:Toggle redraw|n:Auto range|e:Select 2-par point|b:Draw labeled|o:Load branch', { to: 'auto' }),
]

// hints for the few commands that need a tap on the graph
for (const c of COMMANDS) {
  if (c.keys === 'i i') c.tip = TAP_START
  if (c.keys === 's m') c.tip = 'Tap near a fixed point: XPP finds it and shows its stability and eigenvalues'
  if (c.keys === 'i m') c.tip = 'Tap the graph to start one trajectory there'
  if (c.keys === 'w z' || c.keys === 'w o') c.tip = 'Drag a box on the graph (or tap)'
}

/** named keys a user may write in a shortcut, as KeyboardEvent.key values */
export const NAMED_KEYS: Record<string, string> = {
  esc: 'Escape', escape: 'Escape', enter: 'Enter', return: 'Enter', tab: 'Tab',
  left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown',
}

/** "w f" / "wf" / "esc" -> key values XPP receives */
export function parseKeys(text: string): string[] {
  const out: string[] = []
  for (const tok of text.trim().split(/\s+/).filter(Boolean)) {
    const named = NAMED_KEYS[tok.toLowerCase()]
    if (named) out.push(named)
    else out.push(...tok.split(''))
  }
  return out
}

/** the catalogue entry with exactly these keys (and window), if any */
export function findCommand(keys: string, to?: 'auto'): XppCommand | undefined {
  const k = parseKeys(keys).join(' ')
  return COMMANDS.find((c) => c.keys === k && c.to === to)
}
