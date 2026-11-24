// What the editor shell needs from a typing area; Monaco (computers) and
// CodeMirror (phones, tablets) both provide it, loaded only when used.
import type { Palette } from './themes'

export interface Mark {
  line: number // 0-based
  severity: 'error' | 'warning'
  message: string
}

export interface EditorView {
  getValue(): string
  setValue(text: string): void
  onChange(f: () => void): void
  setMarks(marks: Mark[]): void
  /** the arrow on the script line now running (0-based; null: none) */
  setRunLine(line: number | null): void
  focus(): void
  /** go to a line (0-based) */
  reveal(line: number): void
  layout(): void
  dispose(): void
}

export interface Engine {
  name: 'monaco' | 'codemirror'
  create(host: HTMLElement, text: string, language: 'ode' | 'xps' | 'plain', opts: EngineOpts): EditorView
  setTheme(p: Palette): void
  setOptions(o: Partial<EngineOpts>): void
}

/** the running-line arrow's colour: one that reads on every theme */
export const RUN_ARROW = '#ff7a00'

export interface EngineOpts {
  fontSize: number
  wrap: boolean
  minimap: boolean
  onSave: () => void
}

let monaco: Promise<Engine> | null = null
let codemirror: Promise<Engine> | null = null

export function loadEngine(kind: 'monaco' | 'codemirror'): Promise<Engine> {
  if (kind === 'monaco') return (monaco ??= import('./monaco').then((m) => m.engine()))
  return (codemirror ??= import('./cm').then((m) => m.engine()))
}
