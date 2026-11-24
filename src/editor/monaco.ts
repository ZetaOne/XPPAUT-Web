// Monaco (the VS Code editor) for computers.
import * as monaco from './monaco-core'
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker'
import type { EditorView, Engine, EngineOpts, Mark } from './engine'
import { LineStream, startState, tokenOde, tokenXps, type TokState } from './lang'
import type { Palette } from './themes'

;(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = { getWorker: () => new EditorWorker() }

class State implements monaco.languages.IState {
  s: TokState
  constructor(s: TokState) {
    this.s = s
  }
  clone() {
    return new State({ ...this.s })
  }
  equals(o: monaco.languages.IState) {
    return o instanceof State && o.s.option === this.s.option && o.s.lineStart === this.s.lineStart
  }
}

function register(id: 'ode' | 'xps', tok: typeof tokenOde) {
  monaco.languages.register({ id, extensions: ['.' + id] })
  monaco.languages.setTokensProvider(id, {
    getInitialState: () => new State(startState()),
    tokenize(line, state) {
      const st = (state as State).clone() as State
      const s = new LineStream(line)
      const tokens: monaco.languages.IToken[] = []
      while (!s.eol()) {
        s.start = s.pos
        const t = tok(s, st.s)
        if (s.pos === s.start) s.pos++ // never stall
        tokens.push({ startIndex: s.start, scopes: t ?? '' })
      }
      return { tokens, endState: st }
    },
  })
  monaco.languages.setLanguageConfiguration(id, { comments: { lineComment: '#' }, brackets: [['(', ')'], ['[', ']'], ['{', '}']], autoClosingPairs: [{ open: '(', close: ')' }, { open: '[', close: ']' }, { open: '"', close: '"' }] })
}

export function engine(): Engine {
  register('ode', tokenOde)
  register('xps', tokenXps)
  let opts: EngineOpts = { fontSize: 14, wrap: false, minimap: true, onSave: () => {} }
  const editors = new Set<monaco.editor.IStandaloneCodeEditor>()
  return {
    name: 'monaco',
    setTheme(p: Palette) {
      const h = (c: string) => c.replace('#', '')
      monaco.editor.defineTheme('xpp', {
        base: p.id === 'high-contrast' ? 'hc-black' : p.dark ? 'vs-dark' : 'vs',
        inherit: true,
        rules: [
          { token: 'comment', foreground: h(p.comment), fontStyle: 'italic' },
          { token: 'keyword', foreground: h(p.keyword), fontStyle: 'bold' },
          { token: 'option', foreground: h(p.option) },
          { token: 'number', foreground: h(p.number) },
          { token: 'string', foreground: h(p.string) },
          { token: 'function', foreground: h(p.func) },
          { token: 'variable', foreground: h(p.variable) },
          { token: 'deriv', foreground: h(p.deriv), fontStyle: 'bold' },
          { token: 'command', foreground: h(p.command), fontStyle: 'bold' },
          { token: 'operator', foreground: h(p.fg) },
        ],
        colors: { 'editor.background': p.bg, 'editor.foreground': p.fg, 'editor.selectionBackground': p.sel, 'editorGutter.background': p.bg, 'minimap.background': p.bg },
      })
      monaco.editor.setTheme('xpp')
    },
    setOptions(o) {
      opts = { ...opts, ...o }
      for (const e of editors) e.updateOptions({ fontSize: opts.fontSize, wordWrap: opts.wrap ? 'on' : 'off', minimap: { enabled: opts.minimap } })
    },
    create(host, text, language, o): EditorView {
      opts = { ...opts, ...o }
      const e = monaco.editor.create(host, {
        value: text,
        language,
        theme: 'xpp',
        automaticLayout: true,
        fontSize: opts.fontSize,
        wordWrap: opts.wrap ? 'on' : 'off',
        minimap: { enabled: opts.minimap },
        scrollBeyondLastLine: false,
        renderWhitespace: 'selection',
        tabSize: 2,
      })
      editors.add(e)
      e.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => opts.onSave())
      return {
        getValue: () => e.getValue(),
        setValue: (t) => {
          if (t !== e.getValue()) e.setValue(t)
        },
        onChange: (f) => void e.onDidChangeModelContent(() => f()),
        setMarks(marks: Mark[]) {
          const model = e.getModel()
          if (!model) return
          monaco.editor.setModelMarkers(
            model,
            'xpp',
            marks.filter((m) => m.line >= 0).map((m) => ({
              startLineNumber: m.line + 1,
              endLineNumber: m.line + 1,
              startColumn: 1,
              endColumn: model.getLineMaxColumn(Math.min(m.line + 1, model.getLineCount())),
              message: m.message,
              severity: m.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
            })),
          )
        },
        focus: () => e.focus(),
        reveal: (line) => {
          e.revealLineInCenter(line + 1)
          e.setPosition({ lineNumber: line + 1, column: 1 })
          e.focus()
        },
        layout: () => e.layout(),
        dispose: () => {
          editors.delete(e)
          e.getModel()?.dispose()
          e.dispose()
        },
      }
    },
  }
}
