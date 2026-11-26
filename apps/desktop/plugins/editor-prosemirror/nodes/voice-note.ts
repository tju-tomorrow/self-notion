/**
 * `voiceNote` 的 NodeView（D-0215）：空块上一颗麦克风 → 录音 → 微信式语音条。
 *
 * 字节在 Rust 侧直接落 blob，这里只拿 id；播放走 `self-notion://blob/<id>`。
 * 「转文字」是按需的 —— Whisper 只在点了之后才装 / 跑。
 */
import type { Node as PMNode } from 'prosemirror-model'
import type { NodeViewConstructor } from 'prosemirror-view'

import { reportError } from '../../../src/kernel/errors'
import { blobUrl } from '../../../src/platform/blob-url'
import { isWeb } from '../../../src/platform/env'
import { getVoiceApi, takeAutoRecord, type VoiceApi } from '../voice'
import { asString } from './attrs'

const BARS = 26
const MAX_SECS = 300
/** 手写的起伏 —— 等长的正弦看着像音量条，不像一条真的语音。 */
const SHAPE = [
  34, 58, 76, 44, 90, 62, 38, 82, 52, 96, 46, 70, 58, 88, 36, 64, 92, 48, 74, 56, 84, 40, 68, 94, 50, 78,
]
const MIC =
  '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="1.8" width="4" height="7.4" rx="2"/><path d="M3.6 7.4a4.4 4.4 0 0 0 8.8 0M8 11.8V14"/></svg>'
const PLAY =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M4.5 2.8v10.4L13 8z"/></svg>'
const PAUSE =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><rect x="3.6" y="2.8" width="3.2" height="10.4" rx="1"/><rect x="9.2" y="2.8" width="3.2" height="10.4" rx="1"/></svg>'
const STOP = '<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><rect x="3.5" y="3.5" width="9" height="9" rx="1.6"/></svg>'

type Phase = 'idle' | 'recording' | 'ready' | 'unsupported'

function clock(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** 微信那个写法：不到一分钟只有秒，带一个双撇号。 */
function formatDur(sec: number): string {
  const whole = Math.max(0, Math.round(sec))
  if (whole < 60) return `${whole}″`
  return `${Math.floor(whole / 60)}′${String(whole % 60).padStart(2, '0')}″`
}

/** 微信的气泡长度跟时长走：越长的语音越宽（平方根让短语音也能看出差别）。 */
function bubbleWidth(sec: number): number {
  const s = Math.max(1, Math.min(sec || 1, 60))
  return Math.round(132 + Math.sqrt(s / 60) * 168)
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return '出错了'
}

function tag(tagName: string, cls: string, text?: string): HTMLElement {
  const el = document.createElement(tagName)
  el.className = cls
  if (text !== undefined) el.textContent = text
  return el
}

/** 全局只允许一段在录：另一块点麦克风时先把上一段收尾，别让 Rust 直接掐掉它。 */
let activeStop: (() => Promise<void>) | null = null

export const voiceNoteView: NodeViewConstructor = (node, view, getPos) => {
  const dom = tag('div', 'sn-voice')
  dom.contentEditable = 'false'

  const idle = document.createElement('button')
  idle.type = 'button'
  idle.className = 'sn-voice-idle'
  idle.innerHTML = `${MIC}<span>点击录音</span>`

  const rec = tag('div', 'sn-voice-rec')
  const dot = tag('span', 'sn-voice-dot')
  const recWave = tag('div', 'sn-voice-wave')
  const timerEl = tag('span', 'sn-voice-time', '00:00')
  const stopBtn = document.createElement('button')
  stopBtn.type = 'button'
  stopBtn.className = 'sn-voice-stop'
  stopBtn.title = '停止录音'
  stopBtn.innerHTML = STOP
  rec.append(dot, recWave, timerEl, stopBtn)

  const main = tag('div', 'sn-voice-main')
  const bar = tag('div', 'sn-voice-bar')
  bar.setAttribute('role', 'button')
  bar.tabIndex = 0
  const playBtn = document.createElement('button')
  playBtn.type = 'button'
  playBtn.className = 'sn-voice-play'
  playBtn.innerHTML = PLAY
  const wave = tag('div', 'sn-voice-wave')
  const durEl = tag('span', 'sn-voice-dur', '0″')
  bar.append(playBtn, wave, durEl)

  const tools = tag('div', 'sn-voice-tools')
  const transBtn = document.createElement('button')
  transBtn.type = 'button'
  transBtn.className = 'sn-voice-transcribe'
  transBtn.textContent = '转文字'
  const hint = tag('span', 'sn-voice-hint')
  tools.append(transBtn, hint)

  const text = tag('div', 'sn-voice-text')
  text.hidden = true

  const audio = document.createElement('audio')
  audio.preload = 'metadata'

  main.append(bar, tools, text, audio)
  dom.append(idle, rec, main)

  const bars: HTMLElement[] = []
  for (let i = 0; i < BARS; i += 1) {
    const b = document.createElement('i')
    b.style.height = `${SHAPE[i % SHAPE.length]}%`
    b.style.animationDelay = `${(i % 7) * 0.08}s`
    wave.appendChild(b)
    bars.push(b)
  }
  for (let i = 0; i < BARS; i += 1) {
    const b = document.createElement('i')
    b.style.height = `${SHAPE[i % SHAPE.length]}%`
    b.style.animationDelay = `${(i % 7) * 0.08}s`
    recWave.appendChild(b)
  }

  let blobId = ''
  let duration = 0
  let transcript = ''
  let recording = false
  let busy = false
  let disposed = false
  let timer = 0
  let startedAt = 0

  const setPhase = (next: Phase): void => {
    dom.dataset.phase = next
    if (next === 'recording') {
      hint.textContent = ''
    } else if (next === 'ready') {
      transBtn.hidden = isWeb || transcript !== ''
      transBtn.textContent = '转文字'
    }
  }

  const paintProgress = (): void => {
    const total = duration || audio.duration || 0
    const ratio = total > 0 ? Math.min(1, audio.currentTime / total) : 0
    bars.forEach((b, i) => b.classList.toggle('sn-on', (i + 1) / BARS <= ratio))
    const shown = audio.paused ? total : Math.max(0, total - audio.currentTime)
    durEl.textContent = formatDur(shown)
  }

  const setPlayIcon = (playing: boolean): void => {
    playBtn.innerHTML = playing ? PAUSE : PLAY
    dom.dataset.playing = String(playing)
    if (!playing) paintProgress()
  }

  const paint = (n: PMNode): void => {
    blobId = asString(n.attrs.blobId)
    duration = typeof n.attrs.duration === 'number' ? n.attrs.duration : 0
    const next = asString(n.attrs.transcript)
    if (next !== transcript) {
      transcript = next
      text.textContent = transcript
      text.hidden = transcript === ''
      transBtn.hidden = isWeb || transcript !== ''
    }
    durEl.textContent = formatDur(duration)
    dom.style.setProperty('--sn-voice-w', `${bubbleWidth(duration)}px`)
    if (blobId) {
      const src = blobUrl(blobId)
      if (audio.getAttribute('src') !== src) audio.src = src
    } else {
      audio.removeAttribute('src')
    }
    if (!recording && !busy) setPhase(blobId ? 'ready' : 'idle')
  }

  const commit = (patch: Record<string, unknown>): void => {
    const pos = getPos()
    if (pos === undefined) return
    const cur = view.state.doc.nodeAt(pos)
    if (!cur) return
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, ...patch }))
  }

  const togglePlay = async (): Promise<void> => {
    if (!blobId) return
    if (audio.paused) {
      try {
        await audio.play()
      } catch (err) {
        reportError('voice-note', err)
      }
    } else {
      audio.pause()
    }
  }

  const waitModel = async (api: VoiceApi): Promise<void> => {
    const deadline = Date.now() + 30 * 60 * 1000
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 800))
      if (disposed) return
      const st = await api.status()
      if (st.ready) return
      if (st.error) throw new Error(st.error)
      if (Date.now() > deadline) throw new Error('模型下载超时')
      const pct = st.total > 0 ? Math.floor((st.received / st.total) * 100) : 0
      transBtn.textContent = `下载模型 ${pct}%`
    }
  }

  const runTranscribe = async (): Promise<void> => {
    const api = getVoiceApi()
    if (!api || !blobId || busy) return
    busy = true
    transBtn.disabled = true
    transBtn.textContent = '转写中…'
    hint.textContent = ''
    try {
      const st = await api.status()
      if (!st.ready) {
        if (!st.downloading) await api.download()
        transBtn.textContent = '下载模型 0%'
        await waitModel(api)
        if (disposed) return
      }
      transBtn.textContent = '转写中…'
      const result = await api.transcribe(blobId)
      if (disposed) return
      // 交给 `paint` 去写 DOM —— 这里先改 `transcript` 的话，update 会以为没变。
      if (result.trim()) commit({ transcript: result.trim() })
      else hint.textContent = '没听清，可以再试一次'
    } catch (err) {
      if (!disposed) {
        hint.textContent = messageOf(err)
        reportError('voice-note', err)
      }
    } finally {
      if (!disposed) {
        busy = false
        transBtn.disabled = false
        setPhase(blobId ? 'ready' : 'idle')
      }
    }
  }

  const tick = (): void => {
    const sec = (Date.now() - startedAt) / 1000
    timerEl.textContent = clock(sec)
    if (sec >= MAX_SECS) void stopRecording()
  }

  const startRecording = async (): Promise<void> => {
    const api = getVoiceApi()
    if (!api || recording || isWeb) return
    const prev = activeStop
    activeStop = null
    if (prev) await prev()
    if (disposed) return
    try {
      await api.start()
      if (disposed) {
        void api.cancel()
        return
      }
      recording = true
      activeStop = stopRecording
      startedAt = Date.now()
      setPhase('recording')
      tick()
      timer = window.setInterval(tick, 200)
    } catch (err) {
      reportError('voice-note', err)
      hint.textContent = messageOf(err)
    }
  }

  const stopRecording = async (): Promise<void> => {
    const api = getVoiceApi()
    if (!api || !recording) return
    recording = false
    activeStop = null
    window.clearInterval(timer)
    timer = 0
    try {
      const res = await api.stop()
      if (disposed) return
      blobId = res.id
      duration = res.duration
      audio.src = blobUrl(blobId)
      setPhase('ready')
      commit({ blobId: res.id, duration: res.duration })
    } catch (err) {
      reportError('voice-note', err)
      hint.textContent = messageOf(err)
      setPhase(blobId ? 'ready' : 'idle')
    }
  }

  idle.addEventListener('click', () => void startRecording())
  stopBtn.addEventListener('click', () => void stopRecording())
  playBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    void togglePlay()
  })
  bar.addEventListener('click', () => void togglePlay())
  bar.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    void togglePlay()
  })
  transBtn.addEventListener('click', () => void runTranscribe())
  audio.addEventListener('play', () => setPlayIcon(true))
  audio.addEventListener('pause', () => setPlayIcon(false))
  audio.addEventListener('ended', () => setPlayIcon(false))
  audio.addEventListener('timeupdate', paintProgress)

  paint(node)
  if (isWeb) {
    dom.append(tag('div', 'sn-voice-unsupported', '网页端不支持录音'))
    if (!blobId) setPhase('unsupported')
  }

  /** 斜杠插进来的新块自己开始录。 */
  const containerId = (): string => {
    const pos = getPos()
    if (pos === undefined) return ''
    const $pos = view.state.doc.resolve(pos)
    for (let d = $pos.depth; d > 0; d -= 1) {
      const n = $pos.node(d)
      if (n.type.name === 'blockContainer') return String(n.attrs.id ?? '')
    }
    return ''
  }
  if (!isWeb && !blobId && takeAutoRecord(containerId())) void startRecording()

  return {
    dom,
    update: (next) => {
      if (next.type !== node.type) return false
      paint(next)
      return true
    },
    stopEvent: (e) => e.target instanceof Node && dom.contains(e.target),
    ignoreMutation: () => true,
    destroy: () => {
      disposed = true
      if (activeStop === stopRecording) activeStop = null
      if (timer) window.clearInterval(timer)
      audio.pause()
      audio.removeAttribute('src')
      if (recording) {
        recording = false
        void getVoiceApi()?.cancel()
      }
    },
  }
}
