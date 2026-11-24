// CodeMirror for phones and tablets (touch, phone keyboards).
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView as CMView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { StreamLanguage, HighlightStyle, syntaxHighlighting, bracketMatching, foldGutter } from '@codemirror/language'
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { setDiagnostics, lintGutter } from '@codemirror/lint'
import { tags as t } from '@lezer/highlight'
import type { EditorView, Engine, EngineOpts, Mark } from './engine'
import { startState, tokenOde, tokenXps, type Tok } from './lang'
import type { Palette } from './themes'

// StreamLanguage's classic token names (each maps to a highlight tag)
const TAG: Record<Exclude<Tok, null>, string> = {
  comment: 'comment', keyword: 'keyword', option: 'property', number: 'number', string: 'string',
  function: 'builtin', variable: 'variable', operator: 'operator', command: 'meta', deriv: 'def',
}

const lang = (tok: typeof tokenOde) =>
  StreamLanguage.define({
    startState,
    token: (s, st) => {
      const r = tok(s as never, st)
      return r ? TAG[r] : null
    },
    languageData: { commentTokens: { line: '#' } },
  })

const ODE = lang(tokenOde)
const XPS = lang(tokenXps)

function themeExt(p: Palette) {
  const hl = HighlightStyle.define([
    { tag: t.comment, color: p.comment, fontStyle: 'italic' },
    { tag: t.keyword, color: p.keyword, fontWeight: 'bold' },
    { tag: t.propertyName, color: p.option },
    { tag: t.number, color: p.number },
    { tag: t.string, color: p.string },
    { tag: t.standard(t.variableName), color: p.func },
    { tag: t.variableName, color: p.variable },
    { tag: t.definition(t.variableName), color: p.deriv, fontWeight: 'bold' },
    { tag: t.meta, color: p.command, fontWeight: 'bold' },
    { tag: t.operator, color: p.fg },
  ])
  return [
    CMView.theme(
      {
        '&': { color: p.fg, backgroundColor: p.bg, height: '100%' },
        '.cm-content': { caretColor: p.accent },
        '.cm-cursor, .cm-dropCursor': { borderLeftColor: p.accent },
        '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: p.sel },
        '.cm-gutters': { backgroundColor: p.bg, color: p.comment, border: 'none' },
        '.cm-activeLine': { backgroundColor: p.dark ? '#ffffff0a' : '#0000000a' },
        '.cm-activeLineGutter': { backgroundColor: 'transparent', color: p.fg },
        '.cm-panels': { backgroundColor: p.side, color: p.fg },
        '.cm-scroller': { fontFamily: 'ui-monospace, Menlo, Consolas, monospace' },
      },
      { dark: p.dark },
    ),
    syntaxHighlighting(hl),
  ]
}

export function engine(): Engine {
  let palette: Palette | null = null
  let opts: EngineOpts = { fontSize: 14, wrap: true, minimap: false, onSave: () => {} }
  const views = new Set<{ view: CMView; theme: Compartment; look: Compartment }>()
  const look = () => [CMView.theme({ '&': { fontSize: opts.fontSize + 'px' } }), opts.wrap ? CMView.lineWrapping : []]
  return {
    name: 'codemirror',
    setTheme(p) {
      palette = p
      for (const v of views) v.view.dispatch({ effects: v.theme.reconfigure(themeExt(p)) })
    },
    setOptions(o) {
      opts = { ...opts, ...o }
      for (const v of views) v.view.dispatch({ effects: v.look.reconfigure(look()) })
    },
    create(host, text, language, o): EditorView {
      opts = { ...opts, ...o }
      const theme = new Compartment()
      const lk = new Compartment()
      const listeners: Array<() => void> = []
      const view = new CMView({
        parent: host,
        state: EditorState.create({
          doc: text,
          extensions: [
            lineNumbers(),
            foldGutter(),
            highlightActiveLine(),
            highlightActiveLineGutter(),
            drawSelection(),
            history(),
            bracketMatching(),
            search({ top: true }),
            highlightSelectionMatches(),
            lintGutter(),
            language === 'ode' ? ODE : language === 'xps' ? XPS : [],
            keymap.of([{ key: 'Mod-s', run: () => (opts.onSave(), true) }, indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
            theme.of(palette ? themeExt(palette) : []),
            lk.of(look()),
            CMView.updateListener.of((u) => {
              if (u.docChanged) for (const f of listeners) f()
            }),
          ],
        }),
      })
      const entry = { view, theme, look: lk }
      views.add(entry)
      return {
        getValue: () => view.state.doc.toString(),
        setValue: (t) => {
          if (t !== view.state.doc.toString()) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: t } })
        },
        onChange: (f) => void listeners.push(f),
        setMarks(marks: Mark[]) {
          const doc = view.state.doc
          view.dispatch(
            setDiagnostics(
              view.state,
              marks.filter((m) => m.line >= 0 && m.line < doc.lines).map((m) => {
                const l = doc.line(m.line + 1)
                return { from: l.from, to: l.to, severity: m.severity, message: m.message }
              }),
            ),
          )
        },
        focus: () => view.focus(),
        reveal: (line) => {
          const l = view.state.doc.line(Math.min(line + 1, view.state.doc.lines))
          view.dispatch({ selection: { anchor: l.from }, scrollIntoView: true })
          view.focus()
        },
        layout: () => view.requestMeasure(),
        dispose: () => {
          views.delete(entry)
          view.destroy()
        },
      }
    },
  }
}
