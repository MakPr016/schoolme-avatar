// lib/lipSync.ts — Phoneme-to-viseme mapping and timeline generation for RPM avatars

export type VisemeName =
  | 'sil' | 'PP' | 'FF' | 'TH' | 'DD' | 'kk'
  | 'CH'  | 'SS' | 'nn' | 'RR' | 'aa' | 'E'
  | 'I'   | 'O'  | 'U'

export interface VisemeEvent {
  viseme: VisemeName
  time: number      // start time in seconds (relative to utterance start)
  duration: number   // duration in seconds
}

export interface LipSyncData {
  timeline: VisemeEvent[]
  totalDuration: number
  startTime: number       // performance.now() ms when utterance started
  isActive: boolean
  audioElement?: HTMLAudioElement | null  // when set, elapsed = audioElement.currentTime
}

export function createLipSyncData(): LipSyncData {
  return { timeline: [], totalDuration: 0, startTime: 0, isActive: false, audioElement: null }
}

// ── Character / digraph → viseme tables ──────────────────────────

const DIGRAPHS: [string, VisemeName][] = [
  ['th', 'TH'], ['sh', 'CH'], ['ch', 'CH'], ['ph', 'FF'],
  ['wh', 'U'],  ['ck', 'kk'], ['ng', 'kk'], ['qu', 'kk'],
  ['ee', 'I'],  ['ea', 'I'],  ['ey', 'I'],  ['ie', 'I'],
  ['oo', 'U'],  ['ou', 'aa'], ['ow', 'aa'],
  ['ai', 'E'],  ['ay', 'E'],  ['ei', 'E'],
  ['oi', 'O'],  ['oy', 'O'],
]

const CHAR_MAP: Record<string, VisemeName> = {
  a: 'aa', e: 'E', i: 'I', o: 'O', u: 'U',
  p: 'PP', b: 'PP', m: 'PP',
  f: 'FF', v: 'FF',
  t: 'DD', d: 'DD',
  k: 'kk', g: 'kk', c: 'kk', q: 'kk', x: 'kk',
  s: 'SS', z: 'SS',
  n: 'nn', l: 'nn',
  r: 'RR', j: 'CH', y: 'I', w: 'U', h: 'sil',
}

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u'])

// ── Timeline builder ─────────────────────────────────────────────

export function computeTimeline(text: string, rate: number = 1.0) {
  const timeline: VisemeEvent[] = []
  const charTimeMap: number[] = new Array(text.length).fill(0)
  const baseDur = 0.06 / rate                      // ~60 ms per phoneme at rate 1
  let time = 0
  const lower = text.toLowerCase()

  for (let i = 0; i < lower.length;) {
    charTimeMap[i] = time
    const ch = lower[i]

    // Non-alphabetic → pause
    if (!/[a-z]/.test(ch)) {
      let pause = 0
      if (ch === ' ')                         pause = baseDur * 0.5
      else if (',;:'.includes(ch))            pause = baseDur * 4
      else if ('.!?'.includes(ch))            pause = baseDur * 6

      if (pause > 0) {
        const last = timeline[timeline.length - 1]
        if (last?.viseme === 'sil') { last.duration += pause }
        else                        { timeline.push({ viseme: 'sil', time, duration: pause }) }
        time += pause
      }
      i++
      continue
    }

    // Try digraph first
    let viseme: VisemeName | undefined
    let step = 1
    if (i + 1 < lower.length) {
      const pair = lower.slice(i, i + 2)
      const match = DIGRAPHS.find(([d]) => d === pair)
      if (match) { viseme = match[1]; step = 2 }
    }
    if (!viseme) viseme = CHAR_MAP[ch] || 'sil'

    const dur = VOWELS.has(ch) ? baseDur * 1.3 : baseDur

    // Merge consecutive identical visemes
    const last = timeline[timeline.length - 1]
    if (last?.viseme === viseme) { last.duration += dur }
    else                        { timeline.push({ viseme, time, duration: dur }) }

    time += dur
    if (step === 2 && i + 1 < lower.length) charTimeMap[i + 1] = time
    i += step
  }

  return { timeline, charTimeMap, totalDuration: time }
}

// ── Runtime: look up current viseme from elapsed time ────────────

export function getCurrentViseme(
  timeline: VisemeEvent[],
  elapsed: number,
): VisemeName {
  if (timeline.length === 0) return 'sil'
  for (const ev of timeline) {
    if (elapsed >= ev.time && elapsed < ev.time + ev.duration) return ev.viseme
  }
  // Past the end → silence
  return 'sil'
}

// ── Build timeline from ElevenLabs alignment data ────────────────

export function buildTimelineFromAlignment(
  characters: string[],
  startTimes: number[],
  endTimes: number[],
): { timeline: VisemeEvent[]; totalDuration: number } {
  const timeline: VisemeEvent[] = []
  let i = 0

  while (i < characters.length) {
    const ch = characters[i].toLowerCase()

    // Non-alphabetic → silence gap
    if (!/[a-z]/.test(ch)) {
      const dur = endTimes[i] - startTimes[i]
      if (dur > 0) {
        const last = timeline[timeline.length - 1]
        if (last?.viseme === 'sil') { last.duration += dur }
        else { timeline.push({ viseme: 'sil', time: startTimes[i], duration: dur }) }
      }
      i++
      continue
    }

    // Try digraph
    let viseme: VisemeName | undefined
    let step = 1
    if (i + 1 < characters.length) {
      const next = characters[i + 1].toLowerCase()
      if (/[a-z]/.test(next)) {
        const pair = ch + next
        const match = DIGRAPHS.find(([d]) => d === pair)
        if (match) { viseme = match[1]; step = 2 }
      }
    }
    if (!viseme) viseme = CHAR_MAP[ch] || 'sil'

    const start = startTimes[i]
    const end = endTimes[i + step - 1] ?? endTimes[i]
    const dur = Math.max(0, end - start)

    // Merge consecutive identical visemes
    const last = timeline[timeline.length - 1]
    if (last?.viseme === viseme) { last.duration += dur }
    else { timeline.push({ viseme, time: start, duration: dur }) }

    i += step
  }

  const totalDuration = endTimes.length > 0 ? endTimes[endTimes.length - 1] : 0
  return { timeline, totalDuration }
}

// ── Morph-target helpers ─────────────────────────────────────────

export const VISEME_TARGETS = [
  'viseme_sil', 'viseme_PP', 'viseme_FF', 'viseme_TH',
  'viseme_DD',  'viseme_kk', 'viseme_CH', 'viseme_SS',
  'viseme_nn',  'viseme_RR', 'viseme_aa', 'viseme_E',
  'viseme_I',   'viseme_O',  'viseme_U',
] as const

/** How strongly each viseme activates its morph target (0–1). */
export const VISEME_INTENSITY: Record<VisemeName, number> = {
  sil: 0,
  PP: 0.50, FF: 0.40, TH: 0.45, DD: 0.45,
  kk: 0.35, CH: 0.45, SS: 0.35, nn: 0.35,
  RR: 0.45,
  aa: 0.75, E: 0.65, I: 0.55, O: 0.70, U: 0.55,
}

/** Supplementary jaw-open amount per viseme. */
export const VISEME_JAW: Record<VisemeName, number> = {
  sil: 0,
  PP: 0,    FF: 0.03, TH: 0.06, DD: 0.08,
  kk: 0.05, CH: 0.08, SS: 0.03, nn: 0.05,
  RR: 0.08,
  aa: 0.30, E: 0.18, I: 0.10, O: 0.25, U: 0.08,
}
