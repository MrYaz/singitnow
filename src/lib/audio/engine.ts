import { db } from '../db'
import { decodeMono } from './decode'

/**
 * Plays several practice files in perfect sync (Web Audio), each with its own
 * volume, and can loop any stretch. Switching voice is just changing volumes,
 * so the song never loses its place.
 */
const PLAY_RATE = 24000
const CACHE = 6

let ctx: AudioContext | null = null
const buffers = new Map<string, Promise<AudioBuffer>>()

function audio(): AudioContext {
  if (!ctx) {
    // iOS: let Web Audio play even when the ringer switch is on silent.
    const nav = navigator as Navigator & { audioSession?: { type: string } }
    if (nav.audioSession) nav.audioSession.type = 'playback'
    ctx = new AudioContext()
  }
  return ctx
}

export function unlockAudio() {
  const c = audio()
  if (c.state !== 'running') void c.resume()
}

export function loadBuffer(fileId: string): Promise<AudioBuffer> {
  const hit = buffers.get(fileId)
  if (hit) {
    buffers.delete(fileId)
    buffers.set(fileId, hit)
    return hit
  }
  const p = (async () => {
    const f = await db.files.get(fileId)
    if (!f) throw new Error('Ljudfilen saknas, importera låten igen.')
    const { pcm } = await decodeMono(f.blob, PLAY_RATE)
    const buf = audio().createBuffer(1, pcm.length, PLAY_RATE)
    buf.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0)
    return buf
  })()
  buffers.set(fileId, p)
  p.catch(() => buffers.delete(fileId))
  while (buffers.size > CACHE) buffers.delete(buffers.keys().next().value!)
  return p
}

export interface PlayOptions {
  from: number
  to?: number
  loop?: boolean
}

type Listener = () => void

export class Mixer {
  private gains = new Map<string, GainNode>()
  private sources: AudioBufferSourceNode[] = []
  private startedAt = 0
  private offset = 0
  private opts: PlayOptions = { from: 0 }
  private endTimer: number | null = null
  private levels = new Map<string, number>()
  private listeners = new Set<Listener>()
  playing = false
  private tracks: string[] = []

  setTracks(fileIds: string[]) {
    this.tracks = fileIds.filter(Boolean)
    return Promise.all(this.tracks.map(loadBuffer))
  }

  setLevel(fileId: string, level: number) {
    this.levels.set(fileId, level)
    const g = this.gains.get(fileId)
    if (g) g.gain.setTargetAtTime(level, audio().currentTime, 0.02)
  }

  level(fileId: string) {
    return this.levels.get(fileId) ?? 1
  }

  onChange(fn: Listener) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    for (const fn of this.listeners) fn()
  }

  async play(opts: PlayOptions) {
    this.stop(false)
    const c = audio()
    if (c.state !== 'running') await c.resume()
    const bufs = await Promise.all(this.tracks.map(loadBuffer))
    const when = c.currentTime + 0.05
    this.opts = opts
    this.sources = bufs.map((buf, i) => {
      const id = this.tracks[i]
      const src = c.createBufferSource()
      src.buffer = buf
      let g = this.gains.get(id)
      if (!g) {
        g = c.createGain()
        g.connect(c.destination)
        this.gains.set(id, g)
      }
      g.gain.value = this.level(id)
      src.connect(g)
      if (opts.loop && opts.to !== undefined) {
        src.loop = true
        src.loopStart = opts.from
        src.loopEnd = opts.to
        src.start(when, opts.from)
      } else if (opts.to !== undefined) {
        src.start(when, opts.from, Math.max(0.05, opts.to - opts.from))
      } else src.start(when, opts.from)
      return src
    })
    this.startedAt = when
    this.offset = opts.from
    this.playing = true
    const dur = (opts.to ?? bufs[0]?.duration ?? 0) - opts.from
    if (!opts.loop) this.endTimer = window.setTimeout(() => this.stop(), dur * 1000 + 80)
    this.emit()
  }

  /** Current position in the song, in seconds. */
  get time(): number {
    if (!this.playing || !ctx) return this.offset
    const t = this.offset + Math.max(0, ctx.currentTime - this.startedAt)
    const { loop, from, to } = this.opts
    if (loop && to !== undefined && t > to) return from + ((t - from) % (to - from))
    return t
  }

  /** Move the play position without playing. */
  seek(t: number) {
    this.stop(false)
    this.offset = t
    this.emit()
  }

  stop(notify = true) {
    if (this.endTimer) clearTimeout(this.endTimer)
    this.endTimer = null
    const t = this.time
    for (const s of this.sources) {
      try {
        s.stop()
      } catch {
        /* already stopped */
      }
      s.disconnect()
    }
    this.sources = []
    if (this.playing) this.offset = t
    this.playing = false
    if (notify) this.emit()
  }
}

/** Play one stretch of one file and resolve when it ends. */
export async function playClip(fileId: string, from: number, to: number, mixer = new Mixer()): Promise<void> {
  await mixer.setTracks([fileId])
  await mixer.play({ from, to })
  await new Promise<void>((resolve) => {
    const off = mixer.onChange(() => {
      if (!mixer.playing) {
        off()
        resolve()
      }
    })
  })
}
