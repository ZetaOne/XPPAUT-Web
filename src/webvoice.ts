// Voice commands on the website (the Android app has its own engine in Java).
// Three ways to turn speech into text, chosen in Settings -> Voice:
//   browser  the browser's own speech recognition (Chrome, Safari, Samsung
//            Internet): nothing to download, but it needs the internet and
//            the browser's company does the recognising (Google, Apple)
//   vosk     Vosk in the page: completely offline and private, a small
//            English model downloaded once
//   whisper  Whisper (tiny.en) in the page: completely offline, the most
//            accurate, slower on phones, downloaded once
// The engines' code and models load only when chosen (never with the page)
// and are kept in the browser (Cache Storage "xpp-voice"; transformers.js
// keeps Whisper's model in its own "transformers-cache").
// What is heard goes to `onHeard`; src/voicecmd.ts turns it into commands.

export type WebEngine = '' | 'off' | 'browser' | 'vosk' | 'whisper'
export type RealEngine = 'browser' | 'vosk' | 'whisper'

export const ENGINES: Record<RealEngine, { name: string; short: string; about: string; mb: number }> = {
  browser: {
    name: 'Browser speech',
    short: 'built in, needs the internet',
    about:
      'Built into the browser: nothing to download. Needs the internet: Chrome sends what you say to Google, Safari to Apple. ' +
      'Works in Chrome, Edge and Samsung Internet (Android) and Safari (iPhone, iPad; turn on Dictation in the phone’s settings); not in Firefox.',
    mb: 0,
  },
  vosk: {
    name: 'Vosk (offline)',
    short: 'about 44 MB once, completely offline',
    about:
      'Completely offline and private: nothing you say leaves the phone. Downloads about 44 MB once (the engine and an English model), ' +
      'then works without the internet, in every browser. Listens for XPP’s commands only, so it is reliable for them.',
    mb: 44,
  },
  whisper: {
    name: 'Whisper (offline)',
    short: 'about 57 MB once, completely offline, slower',
    about:
      'Completely offline and private: nothing you say leaves the phone. Downloads about 57 MB once (the engine and Whisper tiny.en). ' +
      'The most accurate, but slower on phones: it writes down what you said a second or two after you stop.',
    mb: 57,
  },
}

const VOICE_CACHE = 'xpp-voice'
const VOSK_MODEL = 'voice/vosk/model.tar.gz'
const ORT_FILES = ['voice/ort/ort-wasm-simd-threaded.mjs', 'voice/ort/ort-wasm-simd-threaded.wasm']
const WHISPER_ID = 'whisper-tiny.en'

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v)
    } catch {
      /* private mode */
    }
  },
}

const abs = (u: string) => new URL(u, document.baseURI).href

type SR = {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  continuous: boolean
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string; confidence: number }> & { isFinal: boolean }> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
const SpeechRec = (window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }).SpeechRecognition ??
  (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition

/** which engines this browser can run */
export function canRun(e: RealEngine): boolean {
  if (e === 'browser') return !!SpeechRec
  return typeof WebAssembly === 'object' && !!navigator.mediaDevices?.getUserMedia && 'caches' in window
}

/** a file from our cache, else downloaded (with progress) and kept */
async function cachedFile(url: string, progress: (got: number, total: number) => void, signal?: AbortSignal): Promise<Blob> {
  const cache = await caches.open(VOICE_CACHE)
  const hit = await cache.match(abs(url))
  if (hit) return hit.blob()
  const res = await fetch(url, { signal, cache: 'no-cache' })
  if (!res.ok || !res.body) throw new Error(`could not download ${url.split('/').pop()} (${res.status})`)
  const total = Number(res.headers.get('content-length')) || 0
  const reader = res.body.getReader()
  const parts: Uint8Array[] = []
  let got = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
    got += value.length
    progress(got, total)
  }
  const blob = new Blob(parts as BlobPart[], { type: res.headers.get('content-type') ?? 'application/octet-stream' })
  await cache.put(abs(url), new Response(blob, { headers: { 'content-type': blob.type, 'content-length': String(blob.size) } }))
  return blob
}

/** the microphone, as Float32 chunks at the AudioContext's rate */
class Mic {
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private node: ScriptProcessorNode | null = null
  rate = 48000
  onAudio: (data: Float32Array, buffer: AudioBuffer) => void = () => {}
  /** the microphone went away (another app took it, unplugged...) */
  onEnded: () => void = () => {}
  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }, video: false })
    for (const t of this.stream.getAudioTracks()) t.addEventListener('ended', () => this.onEnded())
    this.ctx = new AudioContext()
    this.rate = this.ctx.sampleRate
    // phones suspend audio (a call, another app): carry on when allowed
    const ctx = this.ctx
    ctx.onstatechange = () => {
      if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
    }
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {})
    const src = this.ctx.createMediaStreamSource(this.stream)
    this.node = this.ctx.createScriptProcessor(4096, 1, 1)
    this.node.onaudioprocess = (e) => this.onAudio(e.inputBuffer.getChannelData(0), e.inputBuffer)
    src.connect(this.node)
    this.node.connect(this.ctx.destination) // some browsers only run a connected node
  }
  stop() {
    this.node?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())
    void this.ctx?.close()
    this.ctx = this.stream = this.node = null
  }
}

/** real microphone audio is never exactly zero; a dead source is */
const hasSound = (d: Float32Array) => {
  for (let i = 0; i < d.length; i += 16) if (d[i] !== 0) return true
  return false
}

const rms = (d: Float32Array) => {
  let s = 0
  for (let i = 0; i < d.length; i++) s += d[i] * d[i]
  return Math.sqrt(s / d.length)
}

/** linear resampling to 16 kHz (Whisper) */
function to16k(data: Float32Array, rate: number): Float32Array {
  if (rate === 16000) return data
  const n = Math.floor((data.length * 16000) / rate)
  const out = new Float32Array(n)
  const f = rate / 16000
  for (let i = 0; i < n; i++) {
    const x = i * f
    const i0 = Math.floor(x)
    const t = x - i0
    out[i] = data[i0] * (1 - t) + (data[Math.min(i0 + 1, data.length - 1)] ?? 0) * t
  }
  return out
}

/** a WAV file (tests): mono samples and their rate */
async function decodeWav(url: string): Promise<{ data: Float32Array; rate: number }> {
  const buf = await (await fetch(url)).arrayBuffer()
  const ctx = new OfflineAudioContext(1, 1, 16000)
  const audio = await ctx.decodeAudioData(buf)
  // half a second of quiet first, as when someone taps 🎤 and then speaks
  const lead = Math.round(audio.sampleRate / 2)
  const data = new Float32Array(lead + audio.length)
  data.set(audio.getChannelData(0), lead)
  return { data, rate: audio.sampleRate }
}

export class WebVoice {
  /** what was said: alternatives, best first */
  onHeard: (alts: string[]) => void = () => {}
  /** the words to listen for (Vosk), asked at every start */
  grammarFor: () => string[] = () => []
  notice: (msg: string) => void = () => {}
  /** the first 🎤 tap with no engine chosen: the page asks which */
  onChoose: () => void = () => {}
  /** an engine was chosen here (the page updates Settings) */
  onEngineChange: (e: WebEngine) => void = () => {}

  engine: WebEngine = (store.get('xpp-web-voice') as WebEngine) || ''
  readonly button: HTMLButtonElement
  private buttons: HTMLButtonElement[] = []
  private bar: HTMLElement
  private text: HTMLElement
  private meter: HTMLElement
  private keepOn = false
  private busy = false
  /** loading or downloading an engine (the watchdog waits) */
  private loading = false
  /** last sign of life from the engine (audio, or the recognizer's events) */
  private alive = 0
  /** Whisper is writing down an utterance since then (0: not) */
  private workingSince = 0
  private wave: HTMLCanvasElement
  private peaks: number[] = []
  private waveDrawn = 0
  private viz: Mic | null = null
  private abort: AbortController | null = null
  private hideTimer = 0
  // engines
  private rec: SR | null = null
  private mic: Mic | null = null
  private voskModel: import('vosk-browser').Model | null = null
  private voskRec: { remove(): void; acceptWaveform(b: AudioBuffer): void; acceptWaveformFloat(b: Float32Array, r: number): void; retrieveFinalResult(): void } | null = null
  private asr: ((audio: Float32Array) => Promise<{ text: string } | Array<{ text: string }>>) | null = null

  constructor(host: HTMLElement) {
    this.button = this.makeButton()
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.sleep()
    })
    this.bar = document.createElement('div')
    this.bar.className = 'voicebar'
    this.bar.setAttribute('role', 'status')
    this.bar.hidden = true
    this.bar.innerHTML = '<canvas class="vwave" width="96" height="28" aria-hidden="true"></canvas><i class="vmeter"><b></b></i><span class="vtext"></span><button type="button">Stop</button>'
    this.text = this.bar.querySelector('.vtext')!
    this.meter = this.bar.querySelector('.vmeter b')!
    this.wave = this.bar.querySelector('.vwave')!
    // the watchdog: listening that has gone quiet starts again by itself
    setInterval(() => this.check(), 2000)
    this.bar.querySelector('button')!.addEventListener('click', () => this.sleep())
    host.append(this.bar)
  }

  makeButton(): HTMLButtonElement {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'micbtn'
    b.textContent = '🎤'
    b.setAttribute('aria-label', 'Voice commands')
    b.title = 'Voice: speak commands (tap again to stop)'
    b.addEventListener('click', () => {
      if (this.keepOn || this.busy) return this.sleep()
      if (this.engine === '' || this.engine === 'off') return this.onChoose()
      this.keepOn = true
      void this.listen()
    })
    this.buttons.push(b)
    return b
  }

  setEngine(e: WebEngine) {
    if (e === this.engine) return
    this.sleep()
    this.engine = e
    store.set('xpp-web-voice', e)
    this.onEngineChange(e)
  }

  /** is the engine's download already in this browser? */
  async downloaded(e: RealEngine): Promise<boolean> {
    if (e === 'browser') return true
    try {
      if (e === 'vosk') return !!(await (await caches.open(VOICE_CACHE)).match(abs(VOSK_MODEL)))
      const ort = await (await caches.open(VOICE_CACHE)).match(abs(ORT_FILES[1]))
      const keys = (await caches.has('transformers-cache')) ? await (await caches.open('transformers-cache')).keys() : []
      return !!ort && keys.some((k) => k.url.includes('decoder_model_merged'))
    } catch {
      return false
    }
  }

  /** remove the engine's download from this browser */
  async deleteDownload(e: RealEngine) {
    this.sleep()
    const cache = await caches.open(VOICE_CACHE)
    if (e === 'vosk') {
      await cache.delete(abs(VOSK_MODEL))
      this.voskModel?.terminate()
      this.voskModel = null
    }
    if (e === 'whisper') {
      for (const f of ORT_FILES) await cache.delete(abs(f))
      await caches.delete('transformers-cache')
      this.asr = null
    }
  }

  /** stop listening (until the 🎤 is tapped again) */
  sleep() {
    const was = this.keepOn || this.busy
    this.keepOn = false
    this.busy = false
    this.abort?.abort()
    this.abort = null
    this.rec?.abort()
    this.rec = null
    this.stopEngine()
    this.loading = false
    this.bar.classList.remove('loading')
    this.setOn(false)
    if (was) this.flash('Voice off', 1500)
  }

  /** the engine's pieces off (keepOn stays as it is) */
  private stopEngine() {
    if (this.rec) {
      const r = this.rec
      this.rec = null
      try {
        r.abort()
      } catch {
        /* already ended */
      }
    }
    this.mic?.stop()
    this.mic = null
    this.viz?.stop()
    this.viz = null
    this.voskRec?.remove()
    this.voskRec = null
    this.workingSince = 0
    this.peaks = []
    this.drawWave(true)
  }

  /** every 2 s: listening that has gone quiet (a recognizer that stopped
   *  without saying so, a microphone the phone took away) starts again */
  private check() {
    if (!this.keepOn || this.loading || document.hidden) return
    const now = performance.now()
    if (this.workingSince && now - this.workingSince > 20000) this.workingSince = 0 // a transcription that never came back
    const limit = this.engine === 'browser' ? 15000 : 5000
    if (this.busy && now - this.alive < limit) return
    this.stopEngine()
    this.busy = false
    void this.listen()
  }

  /** a chunk of what the microphone hears, for the waveform */
  private feedWave(d: Float32Array) {
    const now = performance.now()
    const step = 512
    for (let i = 0; i < d.length; i += step) {
      let m = 0
      for (let j = i; j < Math.min(i + step, d.length); j++) m = Math.max(m, Math.abs(d[j]))
      this.peaks.push(m)
    }
    if (this.peaks.length > 96) this.peaks.splice(0, this.peaks.length - 96)
    if (now - this.waveDrawn > 50) this.drawWave()
  }

  private drawWave(clear = false) {
    this.waveDrawn = performance.now()
    const g = this.wave.getContext('2d')
    if (!g) return
    const { width: w, height: h } = this.wave
    g.clearRect(0, 0, w, h)
    g.fillStyle = getComputedStyle(this.bar).color
    g.globalAlpha = 0.35
    g.fillRect(0, h / 2 - 0.5, w, 1)
    if (clear) return
    g.globalAlpha = 1
    g.fillStyle = '#2e7d32'
    const n = this.peaks.length
    for (let i = 0; i < n; i++) {
      const a = Math.min(1, Math.sqrt(this.peaks[i]) * 1.6) * (h / 2 - 1)
      g.fillRect(w - n + i, h / 2 - a, 1, Math.max(1, 2 * a))
    }
  }

  private setOn(on: boolean) {
    for (const b of this.buttons) b.classList.toggle('on', on)
  }

  show(msg: string, live = false) {
    clearTimeout(this.hideTimer)
    this.bar.hidden = false
    this.bar.classList.toggle('live', live)
    this.text.textContent = msg
  }

  flash(msg: string, ms = 2500) {
    this.show(msg)
    this.meter.style.transform = 'scaleX(0)'
    this.hideTimer = window.setTimeout(() => {
      if (!this.keepOn) this.bar.hidden = true
      else this.show(this.listeningText(), true)
    }, ms)
  }

  private listeningText() {
    return this.engine === 'browser' ? 'Listening…' : `Listening (${this.engine === 'vosk' ? 'Vosk' : 'Whisper'}, offline)…`
  }

  private heard(text: string) {
    const t = text.trim()
    if (!t) return
    this.onHeard([t])
  }

  // ---- listening ------------------------------------------------------------

  private async listen() {
    const e = this.engine as RealEngine
    if (!canRun(e)) {
      this.keepOn = false
      return this.flash(e === 'browser' ? 'This browser has no speech recognition: choose Vosk or Whisper in Settings → Voice' : 'This browser cannot run offline speech recognition', 6000)
    }
    this.setOn(true)
    this.busy = true
    this.alive = performance.now()
    try {
      if (e === 'browser') return this.listenBrowser()
      this.loading = true
      if (e === 'vosk') await this.loadVosk()
      else await this.loadWhisper()
      this.loading = false
      this.bar.classList.remove('loading')
      if (!this.keepOn) return
      this.alive = performance.now()
      return await (e === 'vosk' ? this.listenVosk() : this.listenWhisper())
    } catch (err) {
      this.loading = false
      this.bar.classList.remove('loading')
      if ((err as Error).name === 'AbortError') return
      const msg = (err as Error).name === 'NotAllowedError' ? 'The microphone is blocked: allow it for this site (the lock icon by the address)' : `Voice: ${(err as Error).message}`
      this.sleep()
      this.flash(msg, 6000)
    }
  }

  private listenBrowser() {
    const rec = new SpeechRec!()
    this.rec = rec
    rec.lang = 'en-US'
    rec.interimResults = true
    rec.maxAlternatives = 5
    rec.continuous = false
    this.show(this.listeningText(), true)
    const life = () => (this.alive = performance.now())
    const r2 = rec as unknown as Record<string, (() => void) | null>
    for (const ev of ['onstart', 'onaudiostart', 'onsoundstart', 'onspeechstart', 'onspeechend', 'onsoundend', 'onaudioend']) r2[ev] = life
    // the waveform: the page hears the microphone too, on computers only
    // (phones give the microphone to one listener at a time)
    if (!this.viz && document.documentElement.dataset.device === 'desktop' && 'mediaDevices' in navigator) {
      const viz = new Mic()
      this.viz = viz
      viz.onAudio = (d) => this.feedWave(d)
      viz.start().catch(() => {
        if (this.viz === viz) this.viz = null
      })
    }
    rec.onresult = (ev) => {
      life()
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i]
        if (!r.isFinal) {
          this.show(r[0].transcript + '…', true)
          continue
        }
        const alts: string[] = []
        for (let k = 0; k < r.length; k++) alts.push(r[k].transcript.trim())
        if (alts[0]) this.onHeard(alts)
      }
    }
    rec.onerror = (ev) => {
      life()
      if (ev.error === 'no-speech' || ev.error === 'aborted') return
      this.keepOn = false
      this.flash(
        ev.error === 'not-allowed' ? 'The microphone is blocked: allow it for this site' : ev.error === 'network' ? 'Browser speech needs the internet (or choose Vosk or Whisper in Settings → Voice)' : `Voice: ${ev.error}`,
        6000,
      )
    }
    rec.onend = () => {
      if (this.rec !== rec) return
      life()
      if (this.keepOn) {
        // the next command: a fresh recognizer, a moment later (reusing the
        // old one can fail silently on phones)
        setTimeout(() => {
          if (this.keepOn && this.rec === rec) this.listenBrowser()
        }, 250)
        return
      }
      this.rec = null
      this.busy = false
      this.setOn(false)
      this.viz?.stop()
      this.viz = null
    }
    try {
      rec.start()
    } catch {
      /* the watchdog tries again */
    }
  }

  private progress(what: string) {
    return (got: number, total: number) => {
      const mb = (n: number) => (n / 1048576).toFixed(1)
      this.bar.classList.add('loading')
      this.show(`Downloading ${what} (once): ${mb(got)}${total ? ' of ' + mb(total) : ''} MB`, true)
      if (total) this.meter.style.transform = `scaleX(${got / total})`
    }
  }

  private async loadVosk() {
    if (this.voskModel) return
    this.abort = new AbortController()
    this.show('Getting the offline model ready…', true)
    const [lib, blob] = await Promise.all([import('vosk-browser'), cachedFile(VOSK_MODEL, this.progress('the offline speech model'), this.abort.signal)])
    this.show('Starting the offline model…', true)
    const url = URL.createObjectURL(blob)
    try {
      this.voskModel = await lib.createModel(url, -1)
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  /** a Vosk recognizer for `rate`, listening for the commands' words */
  private voskRecognizer(rate: number, onText: (t: string) => void) {
    const words = [...new Set(this.grammarFor().map((w) => w.toLowerCase()).filter(Boolean))]
    const rec = new this.voskModel!.KaldiRecognizer(rate, words.length ? JSON.stringify([...words, '[unk]']) : undefined)
    rec.on('result', (m) => {
      const t = ((m as { result?: { text?: string } }).result?.text ?? '').replace(/\[unk\]/g, '').trim()
      if (t) onText(t)
    })
    rec.on('partialresult', (m) => {
      const p = ((m as { result?: { partial?: string } }).result?.partial ?? '').replace(/\[unk\]/g, '').trim()
      if (p && this.keepOn) this.show(p + '…', true)
    })
    return rec
  }

  private async listenVosk() {
    const mic = new Mic()
    this.mic = mic
    await mic.start()
    const rec = this.voskRecognizer(mic.rate, (t) => this.heard(t))
    this.voskRec = rec
    mic.onEnded = () => (this.alive = 0)
    mic.onAudio = (d, b) => {
      if (hasSound(d)) this.alive = performance.now()
      this.feedWave(d)
      try {
        rec.acceptWaveform(b)
      } catch {
        /* the recognizer was removed */
      }
    }
    this.show(this.listeningText(), true)
  }

  private async loadWhisper() {
    if (this.asr) return
    this.abort = new AbortController()
    this.show('Getting Whisper ready…', true)
    const [mjs, wasm] = await Promise.all(ORT_FILES.map((f) => cachedFile(f, this.progress('the Whisper engine'), this.abort!.signal)))
    if (!this.keepOn) return
    const tf = await import('@huggingface/transformers')
    tf.env.allowLocalModels = false
    tf.env.allowRemoteModels = true
    tf.env.remoteHost = abs('voice/whisper/')
    tf.env.remotePathTemplate = '{model}/'
    tf.env.useBrowserCache = true
    const wasmEnv = tf.env.backends.onnx.wasm!
    wasmEnv.wasmPaths = { mjs: URL.createObjectURL(new Blob([mjs], { type: 'text/javascript' })), wasm: URL.createObjectURL(wasm) }
    wasmEnv.numThreads = 1 // no cross-origin isolation on GitHub Pages
    const files = new Map<string, [number, number]>()
    const pipe = await tf.pipeline('automatic-speech-recognition', WHISPER_ID, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (p.status !== 'progress' || !p.file) return
        files.set(p.file, [p.loaded ?? 0, p.total ?? 0])
        let got = 0
        let total = 0
        for (const [g, t] of files.values()) (got += g), (total += t)
        this.progress('Whisper tiny.en')(got, total)
      },
    })
    this.asr = (audio) => pipe(audio) as Promise<{ text: string }>
  }

  private async transcribe(audio16k: Float32Array): Promise<string> {
    this.show('Writing down what you said…', true)
    const r = await this.asr!(audio16k)
    const text = Array.isArray(r) ? r.map((x) => x.text).join(' ') : r.text
    // Whisper's guesses for silence and noise
    if (/^\s*[([]?(blank_audio|music|silence|inaudible|noise)[)\]]?\s*$/i.test(text)) return ''
    // punctuation off, but not the point of a number (".15", "2.5")
    return text.replace(/[,!?;:]+/g, ' ').replace(/\.(?!\d)/g, ' ').replace(/(^|\s|[a-z])\.(\d)/gi, '$1 point $2').replace(/-/g, ' ').trim()
  }

  private async listenWhisper() {
    const mic = new Mic()
    this.mic = mic
    await mic.start()
    this.show(this.listeningText(), true)
    // one utterance at a time: from the first loud chunk to 0.8 s of quiet
    let chunks: Float32Array[] = []
    let speaking = false
    let quiet = 0
    let noise = 0.01
    let working = false
    mic.onEnded = () => (this.alive = 0)
    mic.onAudio = (d) => {
      if (hasSound(d)) this.alive = performance.now()
      this.feedWave(d)
      if (working && this.workingSince) return
      working = false
      const v = rms(d)
      const sec = d.length / mic.rate
      if (!speaking) {
        noise = 0.95 * noise + 0.05 * v
        if (v > Math.max(0.02, noise * 3)) {
          speaking = true
          quiet = 0
          chunks = [d.slice()]
        }
        return
      }
      chunks.push(d.slice())
      quiet = v < Math.max(0.015, noise * 2) ? quiet + sec : 0
      const len = chunks.length * sec
      if (quiet > 0.8 || len > 8) {
        speaking = false
        working = true
        this.workingSince = performance.now()
        const all = new Float32Array(chunks.reduce((n, c) => n + c.length, 0))
        let o = 0
        for (const c of chunks) all.set(c, o), (o += c.length)
        void this.transcribe(to16k(all, mic.rate))
          .then((t) => this.heard(t))
          .finally(() => {
            working = false
            this.workingSince = 0
            if (this.keepOn) this.show(this.listeningText(), true)
          })
      }
    }
  }

  // ---- tests (Chrome emulating a phone has no microphone) --------------------

  /** recognise a WAV file with an offline engine; resolves to what it heard */
  async testWav(url: string, e: 'vosk' | 'whisper'): Promise<string> {
    this.keepOn = true
    if (e === 'vosk') {
      await this.loadVosk()
      const { data, rate } = await decodeWav(url)
      const out: string[] = []
      const rec = this.voskRecognizer(rate, (t) => out.push(t))
      for (let i = 0; i < data.length; i += 4096) rec.acceptWaveformFloat(data.subarray(i, i + 4096), rate)
      rec.retrieveFinalResult()
      await new Promise((r) => setTimeout(r, 1500))
      rec.remove()
      this.keepOn = false
      return out.join(' | ')
    }
    await this.loadWhisper()
    const { data, rate } = await decodeWav(url)
    const t = await this.transcribe(to16k(data, rate))
    this.keepOn = false
    return t
  }
}
