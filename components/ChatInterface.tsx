// components/ChatInterface.tsx
"use client"

import { useState, useRef, useEffect } from "react"
import { Send, Bot, User, Loader2, StopCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Card } from "@/components/ui/card"
import { AvatarMood } from "./Avatars/david"
import { type VisualizerState } from "./AvatarVisualizer"
import {
    type LipSyncData,
    computeTimeline,
    stretchTimeline,
    createAnalyserForAudio,
} from "@/lib/lipSync"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

type LLMProvider = "ollama" | "groq"

type Message = {
    role: "user" | "assistant"
    content: string
}

type ScriptItem = {
    text: string
    mood: AvatarMood
}

type ChatInterfaceProps = {
    onTalkingStateChange: (isTalking: boolean) => void
    onMoodChange: (mood: AvatarMood) => void
    onVisualizerStateChange: (state: VisualizerState) => void
    lipSyncRef: React.MutableRefObject<LipSyncData>
}

export default function ChatInterface({ onTalkingStateChange, onMoodChange, onVisualizerStateChange, lipSyncRef }: ChatInterfaceProps) {
    const [messages, setMessages] = useState<Message[]>([])
    const [input, setInput] = useState("")
    const [isLoading, setIsLoading] = useState(false)
    const [isSpeaking, setIsSpeaking] = useState(false)
    const [provider, setProvider] = useState<LLMProvider>("ollama")
    const scrollRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)
    const abortRef = useRef(false)
    // Holds the currently playing Audio element so interrupt() can pause it immediately
    const currentAudioRef = useRef<HTMLAudioElement | null>(null)

    useEffect(() => {
        if (scrollRef.current) {
            const viewport = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]')
            if (viewport) {
                (viewport as HTMLElement).scrollTop = (viewport as HTMLElement).scrollHeight
            }
        }
    }, [messages])

    // ── Interrupt: stop audio mid-sentence, reset avatar, re-enable input ──
    const interrupt = () => {
        // 1. Signal the playScript loop to stop iterating
        abortRef.current = true

        // 2. Immediately pause the in-flight audio element
        if (currentAudioRef.current) {
            currentAudioRef.current.pause()
            currentAudioRef.current = null
        }

        // 3. Reset lip sync and avatar state right away — don't wait for onended
        lipSyncRef.current.isActive = false
        lipSyncRef.current.audioElement = null
        lipSyncRef.current.analyser = null
        lipSyncRef.current.analyserBuffer = null
        onTalkingStateChange(false)
        onMoodChange("neutral")

        // 4. Allow the user to type again and focus the input
        setIsSpeaking(false)
        setIsLoading(false)
        onVisualizerStateChange("idle")
        setTimeout(() => inputRef.current?.focus(), 0)
    }

    const analyzeText = (fullText: string): ScriptItem[] => {
        const sentences = fullText.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [fullText]
        return sentences.map(sentence => {
            const trimmed = sentence.trim()
            let mood: AvatarMood = 'neutral'
            if (trimmed.includes("!") || trimmed.toLowerCase().includes("wow") || trimmed.toLowerCase().includes("great")) {
                mood = 'happy'
            } else if (trimmed.includes("?") || trimmed.toLowerCase().includes("what") || trimmed.toLowerCase().includes("hmm")) {
                mood = 'surprise'
            } else if (trimmed.toLowerCase().includes("sorry") || trimmed.toLowerCase().includes("sad") || trimmed.toLowerCase().includes("serious")) {
                mood = 'serious'
            }
            return { text: trimmed, mood }
        })
    }

    /**
     * Stage 1 — deterministic local cleanup.
     * Converts the most common notation issues into speakable text before
     * the narrator LLM pass. This runs instantly with no network cost and
     * ensures the narrator sees clean input rather than raw symbols.
     */
    const toSpokenScript = (md: string): string => {
        let s = md

        // ── Code blocks: replace with a description placeholder ──────────
        // Multiline fenced blocks
        s = s.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang) => {
            const label = lang ? `${lang} code` : 'code'
            return ` [${label} block] `
        })
        // Inline code — expand common notation before stripping backticks
        s = s.replace(/`([^`]+)`/g, (_, inner) => expandNotation(inner))

        // ── Math / operator notation ──────────────────────────────────────
        s = expandNotation(s)

        // ── Markdown structure ────────────────────────────────────────────
        s = s.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')   // links / images
        s = s.replace(/^#{1,6}\s+/gm, '')                  // headings
        s = s.replace(/(\*\*|__)(.*?)\1/g, '$2')            // bold
        s = s.replace(/(\*|_)(.*?)\1/g, '$2')               // italic
        s = s.replace(/~~(.*?)~~/g, '$1')                   // strikethrough
        s = s.replace(/^\s*[-*+]\s+/gm, '')                 // unordered bullets
        s = s.replace(/^\s*\d+\.\s+/gm, '')                 // ordered list numbers
        s = s.replace(/^\s*>\s?/gm, '')                     // blockquotes
        s = s.replace(/^---+$/gm, '')                       // horizontal rules
        s = s.replace(/\|/g, ' ')                           // table pipes

        // ── Abbreviations ─────────────────────────────────────────────────
        s = s.replace(/\betc\.?\b/gi, 'and so on')
        s = s.replace(/\bi\.e\.?\b/gi, 'that is')
        s = s.replace(/\be\.g\.?\b/gi, 'for example')
        s = s.replace(/\bvs\.?\b/gi, 'versus')
        s = s.replace(/\bapprox\.?\b/gi, 'approximately')
        s = s.replace(/\bmax\.?\b/gi, 'maximum')
        s = s.replace(/\bmin\.?\b/gi, 'minimum')
        s = s.replace(/\bno\.\s*(\d)/gi, 'number $1')

        // ── Whitespace cleanup ────────────────────────────────────────────
        s = s.replace(/\n{2,}/g, '. ')
        s = s.replace(/\n/g, ' ')
        s = s.replace(/\s{2,}/g, ' ')
        s = s.replace(/\.\s*\./g, '.')   // double periods from replacements

        return s.trim()
    }

    /**
     * Expands mathematical and code notation into natural spoken English.
     * Applied both to inline code spans and the full text.
     */
    const expandNotation = (s: string): string => {
        return s
            // ── Function calls with argument: det(A), len(x) ─────────────
            .replace(/\bdet\(([^)]+)\)/g, 'the determinant of $1')
            .replace(/\binv\(([^)]+)\)/g, 'the inverse of $1')
            .replace(/\btrace\(([^)]+)\)/g, 'the trace of $1')
            .replace(/\blen\(([^)]+)\)/g, 'the length of $1')
            .replace(/\babs\(([^)]+)\)/g, 'the absolute value of $1')
            .replace(/\bsqrt\(([^)]+)\)/g, 'the square root of $1')
            .replace(/\blog\(([^)]+)\)/g, 'log of $1')
            .replace(/\bsin\(([^)]+)\)/g, 'sine of $1')
            .replace(/\bcos\(([^)]+)\)/g, 'cosine of $1')
            .replace(/\btan\(([^)]+)\)/g, 'tangent of $1')
            // ── Superscripts / powers ─────────────────────────────────────
            .replace(/(\w+)\^2\b/g, '$1 squared')
            .replace(/(\w+)\^3\b/g, '$1 cubed')
            .replace(/(\w+)\^n\b/g, '$1 to the n')
            .replace(/(\w+)\^\{?([^}]+)\}?/g, '$1 to the power of $2')
            // ── Subscripts ────────────────────────────────────────────────
            .replace(/(\w+)_\{?([^}\s]+)\}?/g, '$1 sub $2')
            // ── Big-O notation ────────────────────────────────────────────
            .replace(/\bO\(n\s*log\s*n\)/g, 'order n log n')
            .replace(/\bO\(n\^2\)/g, 'order n squared')
            .replace(/\bO\(n\)/g, 'order n')
            .replace(/\bO\(1\)/g, 'order 1, constant time')
            .replace(/\bO\(log\s*n\)/g, 'order log n')
            // ── Comparison / assignment operators ─────────────────────────
            .replace(/!=/g, ' is not equal to ')
            .replace(/==/g, ' is equal to ')
            .replace(/>=/g, ' is greater than or equal to ')
            .replace(/<=/g, ' is less than or equal to ')
            .replace(/=>/g, ' implies ')
            .replace(/->/g, ' maps to ')
            .replace(/:=/g, ' is defined as ')
            // ── Arithmetic operators (spaced, to avoid false positives) ───
            .replace(/\s\*\s/g, ' times ')
            .replace(/\s\/\s/g, ' divided by ')
            // ── Common code keywords into plain English ───────────────────
            .replace(/\bdef\s+(\w+)\s*\(/g, 'a function called $1 that takes ')
            .replace(/\bclass\s+(\w+)/g, 'a class called $1')
            .replace(/\breturn\b/g, 'return')
            .replace(/\bfor\s+\w+\s+in\s+range\((\w+)\)/g, 'a loop from 0 to $1')
            .replace(/\bimport\s+([\w.]+)/g, 'importing $1')
            // ── LaTeX fragments ───────────────────────────────────────────
            .replace(/\\\[|\\\]|\$\$|\$/g, '')   // strip display/inline math delimiters
            .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '$1 over $2')
            .replace(/\\sqrt\{([^}]+)\}/g, 'the square root of $1')
            .replace(/\\sum/g, 'the sum of')
            .replace(/\\int/g, 'the integral of')
            .replace(/\\infty/g, 'infinity')
            .replace(/\\alpha/g, 'alpha')
            .replace(/\\beta/g, 'beta')
            .replace(/\\theta/g, 'theta')
            .replace(/\\lambda/g, 'lambda')
            .replace(/\\mu/g, 'mu')
            .replace(/\\sigma/g, 'sigma')
            .replace(/\\pi/g, 'pi')
            .replace(/\\\w+/g, '')   // strip any remaining LaTeX commands
    }

    const playScript = async (script: ScriptItem[]) => {
        abortRef.current = false
        setIsSpeaking(true)

        // Pre-fetch all TTS audio in parallel
        const ttsResults = await Promise.all(
            script.map(item =>
                fetch("/api/tts", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ text: item.text }),
                })
                    .then(r => r.json())
                    .catch(() => ({ error: "TTS fetch failed" }))
            )
        )

        for (let i = 0; i < script.length; i++) {
            if (abortRef.current) break

            const tts = ttsResults[i]
            const item = script[i]

            if (tts.error || !tts.audioBase64) {
                console.error("TTS Error:", tts.error)
                continue
            }

            onMoodChange(item.mood)

            const { timeline, totalDuration } = computeTimeline(item.text, 1.0)

            const audioBytes = Uint8Array.from(atob(tts.audioBase64), c => c.charCodeAt(0))
            const blob = new Blob([audioBytes], { type: "audio/mpeg" })
            const url = URL.createObjectURL(blob)
            const audio = new Audio(url)

            // Register so interrupt() can pause it immediately
            currentAudioRef.current = audio

            let analyser: AnalyserNode | null = null
            let analyserBuffer: Uint8Array | null = null
            try {
                const result = createAnalyserForAudio(audio)
                analyser = result.analyser
                analyserBuffer = result.buffer
            } catch (e) {
                console.warn("AudioContext unavailable, falling back to text timeline only:", e)
            }

            await new Promise<void>((resolve) => {
                audio.onloadedmetadata = () => {
                    if (lipSyncRef.current.isActive && isFinite(audio.duration) && audio.duration > 0) {
                        lipSyncRef.current.timeline = stretchTimeline(timeline, totalDuration, audio.duration)
                        lipSyncRef.current.totalDuration = audio.duration
                    }
                }

                audio.onplay = () => {
                    onTalkingStateChange(true)
                    onVisualizerStateChange("speaking")
                    const actualDuration = isFinite(audio.duration) && audio.duration > 0
                        ? audio.duration
                        : totalDuration
                    const scaledTimeline = stretchTimeline(timeline, totalDuration, actualDuration)
                    lipSyncRef.current = {
                        timeline: scaledTimeline,
                        totalDuration: actualDuration,
                        startTime: performance.now(),
                        isActive: true,
                        audioElement: audio,
                        analyser,
                        analyserBuffer,
                    }
                }

                const cleanup = () => {
                    onTalkingStateChange(false)
                    onVisualizerStateChange("idle")
                    lipSyncRef.current.isActive = false
                    lipSyncRef.current.audioElement = null
                    lipSyncRef.current.analyser = null
                    lipSyncRef.current.analyserBuffer = null
                    if (currentAudioRef.current === audio) currentAudioRef.current = null
                    URL.revokeObjectURL(url)
                    resolve()
                }

                audio.onended = cleanup
                audio.onerror = () => { console.error("Audio playback error"); cleanup() }
                audio.play().catch(() => cleanup())
            })

            if (i < script.length - 1 && !abortRef.current) {
                await new Promise(r => setTimeout(r, 200))
            }
        }

        // Only reset if we weren't already cleaned up by interrupt()
        if (!abortRef.current) {
            onTalkingStateChange(false)
            onMoodChange("neutral")
            onVisualizerStateChange("idle")
            setIsSpeaking(false)
            setIsLoading(false)
        }
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!input.trim()) return
        if (isLoading && !isSpeaking) return

        if (isSpeaking) interrupt()

        const userMessage: Message = { role: "user", content: input }
        setMessages(prev => [...prev, userMessage])
        setInput("")
        setIsLoading(true)
        onVisualizerStateChange("thinking")

        try {
            // ── Step 1: get LLM response ──────────────────────────────────
            const response = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    provider,
                    model: provider === "ollama" ? "llama3.1:8b" : "llama-3.3-70b-versatile",
                    messages: [...messages, userMessage],
                }),
            })
            const data = await response.json()
            if (data.error) throw new Error(data.error)
            const textResponse: string = data.content

            // Show the full markdown response in chat
            const botMessage: Message = { role: "assistant", content: textResponse }
            setMessages(prev => [...prev, botMessage])

            // ── Step 2: narrator pass — runs in parallel with nothing yet,
            //   but gives TTS a clean natural script instead of raw markdown.
            //   Stage 1 (toSpokenScript) runs locally and is instant.
            //   Stage 2 (narrator API) uses the same LLM to rewrite for speech.
            const localScript = toSpokenScript(textResponse)

            const narrateRes = await fetch("/api/narrate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    provider,
                    model: provider === "ollama" ? "llama3.1:8b" : "llama-3.3-70b-versatile",
                    content: localScript,
                }),
            })
            const narrateData = await narrateRes.json()
            // Fall back to localScript if narrator failed
            const spokenScript = narrateData.script ?? localScript

            // ── Step 3: analyse mood + play ───────────────────────────────
            const script = analyzeText(spokenScript)
            await playScript(script)

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : "Connection failed."
            setMessages(prev => [...prev, { role: "assistant", content: errorMsg }])
            setIsLoading(false)
            setIsSpeaking(false)
            onVisualizerStateChange("idle")
        }
    }

    return (
        <Card className="flex flex-col h-full w-full border-border bg-card shadow-sm overflow-hidden rounded-xl max-lg:border-0 max-lg:shadow-none max-lg:bg-transparent max-lg:rounded-none pb-0">
            {/* Header */}
            <div className="flex-none pb-4 px-4 border-b border-border flex items-center gap-3 max-lg:hidden">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <Bot className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1">
                    <h2 className="text-sm font-semibold text-foreground">SchoolMe : David</h2>
                    <p className="text-xs text-muted-foreground">Deepgram TTS</p>
                </div>
                <div className="flex items-center gap-1 bg-muted/50 rounded-full p-0.5">
                    <button
                        type="button"
                        onClick={() => setProvider("ollama")}
                        className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                            provider === "ollama"
                                ? "bg-background text-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        Ollama
                    </button>
                    <button
                        type="button"
                        onClick={() => setProvider("groq")}
                        className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                            provider === "groq"
                                ? "bg-background text-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        Groq
                    </button>
                </div>
            </div>

            {/* Messages */}
            <div className="flex-1 min-h-0 overflow-hidden relative max-lg:hidden">
                <ScrollArea className="h-full w-full p-4" ref={scrollRef}>
                    <div className="space-y-6 pb-4">
                        {messages.length === 0 && (
                            <div className="flex flex-col items-center justify-center text-center mt-20 opacity-50">
                                <Bot className="w-12 h-12 text-muted-foreground mb-4" />
                                <p className="text-muted-foreground text-sm">Say hello to start the conversation.</p>
                            </div>
                        )}
                        {messages.map((msg, idx) => (
                            <div key={idx} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                                {msg.role === "assistant" && (
                                    <div className="w-8 h-8 rounded-full border border-border bg-muted flex items-center justify-center shrink-0 mt-1">
                                        <Bot className="w-4 h-4 text-muted-foreground" />
                                    </div>
                                )}
                                <div className={`rounded-2xl px-5 py-3 text-sm max-w-[85%] shadow-sm ${msg.role === "user" ? "bg-primary text-primary-foreground rounded-tr-none" : "bg-white border border-border text-foreground rounded-tl-none"}`}>
                                    {msg.role === "assistant" ? (
                                        <div className="prose prose-sm prose-neutral max-w-none [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_pre]:my-2 [&_pre]:bg-neutral-100 [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_code]:text-xs [&_code]:bg-neutral-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-medium [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_table]:text-xs [&_th]:px-2 [&_th]:py-1 [&_td]:px-2 [&_td]:py-1 [&_a]:text-primary [&_a]:underline">
                                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                                        </div>
                                    ) : (
                                        msg.content
                                    )}
                                </div>
                                {msg.role === "user" && (
                                    <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center shrink-0 mt-1">
                                        <User className="w-4 h-4 text-primary-foreground" />
                                    </div>
                                )}
                            </div>
                        ))}
                        {isLoading && !isSpeaking && (
                            <div className="flex justify-start gap-3">
                                <div className="w-8 h-8 rounded-full border bg-muted flex items-center justify-center shrink-0">
                                    <Bot className="w-4 h-4 text-muted-foreground" />
                                </div>
                                <div className="bg-muted/50 rounded-2xl rounded-tl-none px-4 py-3 flex items-center gap-2">
                                    <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
                                    <span className="text-xs text-muted-foreground">Thinking...</span>
                                </div>
                            </div>
                        )}
                    </div>
                </ScrollArea>
            </div>

            <div className="flex-none p-3 pb-5 lg:p-4 max-lg:bg-background/80 max-lg:backdrop-blur-md lg:bg-card lg:border-t border-border">
                {/* Provider toggle — mobile */}
                <div className="flex items-center justify-between mb-2 lg:hidden">
                    <div className="flex items-center gap-2">
                        <Bot className="w-4 h-4 text-primary" />
                        <span className="text-xs font-medium text-foreground">David</span>
                    </div>
                    <div className="flex items-center gap-1 bg-muted/50 rounded-full p-0.5">
                        <button type="button" onClick={() => setProvider("ollama")} className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium transition-all ${provider === "ollama" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}>Ollama</button>
                        <button type="button" onClick={() => setProvider("groq")} className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium transition-all ${provider === "groq" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}>Groq</button>
                    </div>
                </div>

                <form onSubmit={handleSubmit} className="flex gap-2 items-center relative">
                    <Input
                        ref={inputRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder={isSpeaking ? "Type to interrupt..." : "Ask anything..."}
                        className="pr-20 py-6 bg-muted/20 border-border focus-visible:ring-primary/20 rounded-full transition-all"
                        // Only block input while the LLM is thinking — never while speaking
                        disabled={isLoading && !isSpeaking}
                    />

                    {/* Stop button — visible while avatar is speaking */}
                    {isSpeaking && (
                        <Button
                            type="button"
                            onClick={interrupt}
                            size="icon"
                            variant="ghost"
                            className="absolute right-12 top-1.5 h-9 w-9 rounded-full text-destructive hover:bg-destructive/10 transition-all"
                            title="Stop speaking"
                        >
                            <StopCircle className="w-5 h-5" />
                        </Button>
                    )}

                    {/* Send button */}
                    <Button
                        type="submit"
                        disabled={(isLoading && !isSpeaking) || !input.trim()}
                        size="icon"
                        className="absolute right-1.5 top-1.5 h-9 w-9 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground transition-all"
                    >
                        <Send className="w-4 h-4" />
                    </Button>
                </form>
            </div>
        </Card>
    )
}