"use client"

// components/AvatarVisualizer.tsx
// Three-state dot visualizer for the avatar panel:
//   idle      → 4 dots at equal low height (static wave)
//   thinking  → 4 dots pulsing in a travelling wave (loading)
//   speaking  → 4 dots driven by real audio amplitude from the AnalyserNode

import { useRef, useEffect } from "react"

export type VisualizerState = "idle" | "thinking" | "speaking"

interface AvatarVisualizerProps {
    state: VisualizerState
    /** Optional AnalyserNode — when provided in "speaking" state the dots
     *  reflect real audio frequency bands instead of a sine wave estimate. */
    analyser?: AnalyserNode | null
}

const NUM_DOTS = 10
const DOT_SIZE = 5          // px diameter
const MAX_HEIGHT = 36        // px — tallest a dot can stretch
const MIN_HEIGHT = DOT_SIZE  // px — shortest (idle / silence)
const GAP = 14               // px between dot centres

// How fast each state animates (ms)
const THINKING_PERIOD = 900  // full wave cycle
const SPEAKING_PERIOD = 600

export default function AvatarVisualizer({ state, analyser }: AvatarVisualizerProps) {
    const dotsRef = useRef<(HTMLDivElement | null)[]>([])
    const rafRef = useRef<number>(0)
    const startRef = useRef<number>(performance.now())
    const fftBuffer = useRef<Uint8Array | null>(null)

    useEffect(() => {
        // Prep the FFT buffer once the analyser arrives
        if (analyser && !fftBuffer.current) {
            fftBuffer.current = new Uint8Array(analyser.frequencyBinCount)
        }
    }, [analyser])

    useEffect(() => {
        startRef.current = performance.now()
        cancelAnimationFrame(rafRef.current)

        const animate = (now: number) => {
            const elapsed = now - startRef.current
            const dots = dotsRef.current

            if (state === "idle") {
                dots.forEach((dot, i) => {
                    if (!dot) return
                    const phase = (i / NUM_DOTS) * Math.PI * 2
                    const norm = (Math.sin(phase) + 1) / 2          // 0–1
                    const h = MIN_HEIGHT + norm * (MAX_HEIGHT * 0.25 - MIN_HEIGHT)
                    dot.style.height = `${h}px`
                    dot.style.opacity = "0.35"
                })
                return
            }

            if (state === "thinking") {
                const period = THINKING_PERIOD
                dots.forEach((dot, i) => {
                    if (!dot) return
                    const phase = ((elapsed % period) / period) * Math.PI * 2
                    const offset = (i / NUM_DOTS) * Math.PI * 2
                    const norm = (Math.sin(phase - offset) + 1) / 2 
                    const eased = norm < 0.5
                        ? 2 * norm * norm
                        : 1 - Math.pow(-2 * norm + 2, 2) / 2
                    const h = MIN_HEIGHT + eased * (MAX_HEIGHT - MIN_HEIGHT)
                    dot.style.height = `${h}px`
                    dot.style.opacity = `${0.5 + eased * 0.5}`
                })
            }

            if (state === "speaking") {
                if (analyser && fftBuffer.current) {
                    // Real audio — read frequency bands
                    analyser.getByteFrequencyData(fftBuffer.current as any)
                    const binCount = fftBuffer.current.length
                    // Map 4 dots to 4 frequency bands (low → high)
                    dots.forEach((dot, i) => {
                        if (!dot) return
                        // Sample the lower half of the spectrum (speech energy)
                        const lo = Math.floor((i / NUM_DOTS) * binCount * 0.5)
                        const hi = Math.floor(((i + 1) / NUM_DOTS) * binCount * 0.5)
                        let sum = 0
                        for (let b = lo; b < hi; b++) sum += fftBuffer.current![b]
                        const avg = sum / (hi - lo)           // 0–255
                        const norm = avg / 255
                        const h = MIN_HEIGHT + norm * (MAX_HEIGHT - MIN_HEIGHT)
                        dot.style.height = `${h}px`
                        dot.style.opacity = `${0.6 + norm * 0.4}`
                    })
                } else {
                    // Fallback: estimated sine wave when no analyser yet
                    const period = SPEAKING_PERIOD
                    dots.forEach((dot, i) => {
                        if (!dot) return
                        const phase = ((elapsed % period) / period) * Math.PI * 2
                        const offset = (i / NUM_DOTS) * Math.PI * 2
                        const norm = (Math.sin(phase - offset) + 1) / 2
                        const h = MIN_HEIGHT + norm * (MAX_HEIGHT - MIN_HEIGHT)
                        dot.style.height = `${h}px`
                        dot.style.opacity = `${0.6 + norm * 0.4}`
                    })
                }
            }

            rafRef.current = requestAnimationFrame(animate)
        }

        rafRef.current = requestAnimationFrame(animate)
        return () => cancelAnimationFrame(rafRef.current)
    }, [state, analyser])

    // Color per state
    const dotColor =
        state === "thinking" ? "bg-chart-3" :
        state === "speaking" ? "bg-chart-3" :
        "bg-muted-foreground/40"

    return (
        <div className="flex flex-col items-center gap-2">
            {/* Dots */}
            <div
                className="flex items-end justify-center"
                style={{ gap: `${GAP - DOT_SIZE}px`, height: `${MAX_HEIGHT + 4}px` }}
            >
                {Array.from({ length: NUM_DOTS }).map((_, i) => (
                    <div
                        key={i}
                        ref={el => { dotsRef.current[i] = el }}
                        className={`rounded-full transition-colors duration-300 ${dotColor}`}
                        style={{
                            width: `${DOT_SIZE}px`,
                            height: `${MIN_HEIGHT}px`,
                            // Use will-change so the browser composites these cheaply
                            willChange: "height, opacity",
                        }}
                    />
                ))}
            </div>

            {/* Label */}
            <span className="text-xs font-medium tracking-wide transition-all duration-300"
                style={{
                    color: state === "idle"
                        ? "var(--sidebar-primary-foreground)"
                        : state === "thinking"
                        ? "var(--chart-2)"
                        : "var(--sidebar-primary-foreground)",
                    opacity: state === "idle" ? 0.7 : 1,
                }}
            >
                {state === "thinking" ? "Thinking…" :
                 state === "speaking" ? "Speaking" :
                 "David"}
            </span>
        </div>
    )
}