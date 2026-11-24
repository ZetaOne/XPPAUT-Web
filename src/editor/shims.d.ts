declare module '@jspawn/ghostscript-wasm/gs.mjs' {
  const createGs: (opts: object) => Promise<{ FS: { writeFile(p: string, d: Uint8Array): void; readFile(p: string): Uint8Array }; callMain(args: string[]): number }>
  export default createGs
}
// Monaco's editor features (side-effect imports in monaco-core.ts)
declare module 'monaco-editor/editor/contrib/*'
declare module 'monaco-editor/editor/browser/*'
declare module 'monaco-editor/editor/standalone/*'
declare module 'monaco-editor/features/*'
declare module 'monaco-editor/base/*'
declare module 'monaco-editor/editor/common/*'
declare module 'monaco-editor/platform/*'
declare module 'monaco-esm/*'
