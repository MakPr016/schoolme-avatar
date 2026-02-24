// components/ChatInterface.tsx
"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import {
    Send, Bot, User, Loader2, StopCircle,
    Paperclip, X, ChevronLeft, ChevronRight,
    MessageSquare, FileText, MessageSquareQuote,
} from "lucide-react"
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
type Message = { role: "user" | "assistant"; content: string }
type ScriptItem = { text: string; mood: AvatarMood }
type View = "chat" | "pdf"

type PDFState = {
    fileName: string
    numPages: number
    currentPage: number
    extractedText: string[]
    selectedText: string
    pdfDoc: any
}

type ChatInterfaceProps = {
    onTalkingStateChange: (isTalking: boolean) => void
    onMoodChange: (mood: AvatarMood) => void
    onVisualizerStateChange: (state: VisualizerState) => void
    lipSyncRef: React.MutableRefObject<LipSyncData>
}

let pdfJsLoaded = false
async function ensurePdfJs(): Promise<any> {
    if (pdfJsLoaded && (window as any).pdfjsLib) return (window as any).pdfjsLib
    await new Promise<void>((resolve, reject) => {
        const s = document.createElement("script")
        s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"
        s.onload = () => resolve()
        s.onerror = () => reject(new Error("PDF.js load failed"))
        document.head.appendChild(s)
    })
    const lib = (window as any).pdfjsLib
    lib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"

    // Inject minimal CSS so renderTextLayer spans are transparent & selectable
    if (!document.getElementById("pdfjs-text-layer-style")) {
        const style = document.createElement("style")
        style.id = "pdfjs-text-layer-style"
        style.textContent = `
            .schoolme-text-layer span,
            .schoolme-text-layer br {
                color: transparent;
                position: absolute;
                white-space: pre;
                cursor: text;
                transform-origin: 0% 0%;
                user-select: text;
                -webkit-user-select: text;
                line-height: 1;
            }
            .schoolme-text-layer ::selection {
                background: rgba(100, 80, 255, 0.25);
                color: transparent;
            }
            .schoolme-text-layer ::-moz-selection {
                background: rgba(100, 80, 255, 0.25);
                color: transparent;
            }
            .schoolme-text-layer .endOfContent {
                display: block;
                position: absolute;
                left: 0; top: 100%;
                right: 0; bottom: 0;
                overflow: hidden;
                opacity: 0;
                cursor: default;
                user-select: none;
            }
        `
        document.head.appendChild(style)
    }

    pdfJsLoaded = true
    return lib
}

export default function ChatInterface({
    onTalkingStateChange,
    onMoodChange,
    onVisualizerStateChange,
    lipSyncRef,
}: ChatInterfaceProps) {
    const [messages, setMessages] = useState<Message[]>([])
    const [input, setInput] = useState("")
    const [isLoading, setIsLoading] = useState(false)
    const [isSpeaking, setIsSpeaking] = useState(false)
    const [provider, setProvider] = useState<LLMProvider>("ollama")
    const [isDragging, setIsDragging] = useState(false)
    const scrollRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)
    const abortRef = useRef(false)
    const currentAudioRef = useRef<HTMLAudioElement | null>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)

    // PDF state
    const [pdf, setPdf] = useState<PDFState | null>(null)
    const [view, setView] = useState<View>("chat")
    const [pdfLoading, setPdfLoading] = useState(false)
    const [pdfError, setPdfError] = useState<string | null>(null)
    const [selectionTooltip, setSelectionTooltip] = useState<{ x: number; y: number } | null>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const textLayerRef = useRef<HTMLDivElement>(null)
    const pdfContainerRef = useRef<HTMLDivElement>(null)   // scrollable outer div
    const canvasWrapperRef = useRef<HTMLDivElement>(null)  // inner div wrapping canvas + text layer
    const renderTaskRef = useRef<any>(null)

    // Auto-scroll chat
    useEffect(() => {
        if (scrollRef.current) {
            const vp = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]')
            if (vp) (vp as HTMLElement).scrollTop = (vp as HTMLElement).scrollHeight
        }
    }, [messages])

    // ── Render canvas page + text layer ──────────────────────────────────────
    const renderPage = useCallback(async (pdfDoc: any, pageNum: number) => {
        if (!canvasRef.current || !textLayerRef.current || !pdfContainerRef.current) return

        // Cancel any in-progress render
        if (renderTaskRef.current) {
            try { renderTaskRef.current.cancel() } catch {}
            renderTaskRef.current = null
        }

        const page = await pdfDoc.getPage(pageNum)

        // Scale to CSS width, then multiply by devicePixelRatio for crisp rendering
        const containerWidth = pdfContainerRef.current.clientWidth - 48
        const baseViewport = page.getViewport({ scale: 1 })
        const cssScale = Math.max(0.5, containerWidth / baseViewport.width)
        const dpr = window.devicePixelRatio || 1
        const viewport = page.getViewport({ scale: cssScale * dpr })

        // ── 1. Render to canvas at physical resolution ─────────────────────
        const canvas = canvasRef.current
        canvas.width = viewport.width            // physical pixels
        canvas.height = viewport.height
        canvas.style.width  = `${Math.round(viewport.width  / dpr)}px`  // CSS px
        canvas.style.height = `${Math.round(viewport.height / dpr)}px`

        const ctx = canvas.getContext("2d")!
        const task = page.render({ canvasContext: ctx, viewport })
        renderTaskRef.current = task
        try { await task.promise } catch (e: any) {
            if (e?.name !== "RenderingCancelledException") console.error(e)
        }

        // ── 2. Build text layer using PDF.js renderTextLayer API ───────────
        const tl = textLayerRef.current
        tl.innerHTML = ""
        // Text layer is sized in CSS pixels (matching the CSS size of the canvas)
        const cssW = Math.round(viewport.width  / dpr)
        const cssH = Math.round(viewport.height / dpr)
        tl.style.width    = `${cssW}px`
        tl.style.height   = `${cssH}px`
        tl.style.position = "absolute"
        tl.style.top      = "0"
        tl.style.left     = "0"
        tl.style.overflow = "hidden"

        const textContent = await page.getTextContent()
        const lib = (window as any).pdfjsLib

        // renderTextLayer needs a viewport at CSS scale (not physical pixels)
        const cssViewport = page.getViewport({ scale: cssScale })

        // Use renderTextLayer if available (PDF.js ≥ 2.x)
        if (lib.renderTextLayer) {
            try {
                // PDF.js v3 requires --scale-factor matching the CSS viewport scale
                tl.style.setProperty("--scale-factor", String(cssScale))
                lib.renderTextLayer({
                    textContentSource: textContent,
                    container: tl,
                    viewport: cssViewport,
                    textDivs: [],
                })
            } catch {
                // Fallback to manual placement if renderTextLayer fails
                buildManualTextLayer(tl, textContent, cssViewport, lib)
            }
        } else {
            buildManualTextLayer(tl, textContent, viewport, lib)
        }
    }, [])

    /** Manual fallback: place spans to match canvas text positions exactly. */
    const buildManualTextLayer = (
        tl: HTMLDivElement,
        textContent: any,
        viewport: any,
        lib: any,
    ) => {
        textContent.items.forEach((item: any) => {
            if (!item.str) return
            // item.transform is a 6-element CTM [a,b,c,d,e,f] in PDF space
            // Apply viewport transform to get canvas-space coordinates
            const tx = lib.Util.transform(viewport.transform, item.transform)
            // tx[4], tx[5] = canvas x, y of glyph origin (bottom-left in PDF = top-left after transform)
            // Font height from the matrix scale components
            const fontH = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3])
            // Width scaling: PDF.js tells us the width via item.width (in text-space units)
            const scaleX = item.width > 0
                ? (item.width * viewport.scale) / (item.str.length * fontH)
                : 1

            const span = document.createElement("span")
            span.textContent = item.str
            span.setAttribute("role", "presentation")
            span.style.cssText = [
                "position:absolute",
                `left:${tx[4]}px`,
                // tx[5] is the baseline; subtract fontH to get top-left
                `top:${tx[5] - fontH}px`,
                `font-size:${fontH}px`,
                "font-family:sans-serif",
                `transform:scaleX(${scaleX.toFixed(4)})`,
                "transform-origin:left top",
                "white-space:pre",
                "color:transparent",
                "cursor:text",
                "user-select:text",
                "-webkit-user-select:text",
                "-moz-user-select:text",
                "line-height:1",
                "pointer-events:all",
            ].join(";")
            tl.appendChild(span)
        })
    }

    // Re-render when page or view changes
    useEffect(() => {
        if (pdf && view === "pdf") {
            renderPage(pdf.pdfDoc, pdf.currentPage)
        }
    }, [pdf?.currentPage, view, renderPage])

    // ── Load PDF ──────────────────────────────────────────────────────────────
    const loadPDF = async (file: File) => {
        if (!file.name.toLowerCase().endsWith(".pdf")) {
            setPdfError("Please upload a PDF file.")
            return
        }
        setPdfError(null)
        setPdfLoading(true)
        try {
            const lib = await ensurePdfJs()
            const buf = await file.arrayBuffer()
            const pdfDoc = await lib.getDocument({ data: buf }).promise
            const numPages = pdfDoc.numPages

            // Extract text in background for LLM context
            const extractedText: string[] = []
            for (let i = 1; i <= numPages; i++) {
                const p = await pdfDoc.getPage(i)
                const c = await p.getTextContent()
                extractedText.push(c.items.map((x: any) => x.str).join(" ").replace(/\s+/g, " ").trim())
            }

            setPdf({ fileName: file.name, numPages, currentPage: 1, extractedText, selectedText: "", pdfDoc })
            setView("pdf")
        } catch (e) {
            setPdfError("Could not open PDF. Please try another file.")
            console.error(e)
        } finally {
            setPdfLoading(false)
        }
    }

    const goToPage = (delta: number) => {
        if (!pdf) return
        const next = Math.max(1, Math.min(pdf.numPages, pdf.currentPage + delta))
        setPdf(p => p ? { ...p, currentPage: next, selectedText: "" } : p)
        setSelectionTooltip(null)
        window.getSelection()?.removeAllRanges()
    }

    const closePDF = () => {
        setPdf(null); setView("chat"); setSelectionTooltip(null)
        if (fileInputRef.current) fileInputRef.current.value = ""
    }

    // ── Text selection in text layer ──────────────────────────────────────────
    const handleTextLayerMouseUp = () => {
        const sel = window.getSelection()
        if (!sel || sel.isCollapsed) {
            setSelectionTooltip(null)
            setPdf(p => p ? { ...p, selectedText: "" } : p)
            return
        }
        const text = sel.toString().trim()
        if (!text || text.length < 4) { setSelectionTooltip(null); return }

        setPdf(p => p ? { ...p, selectedText: text } : p)

        // Position tooltip relative to the inner canvas wrapper div
        try {
            const range = sel.getRangeAt(0)
            const selRect = range.getBoundingClientRect()
            const wrapperRect = canvasWrapperRef.current?.getBoundingClientRect()
            if (wrapperRect) {
                setSelectionTooltip({
                    x: selRect.left + selRect.width / 2 - wrapperRect.left,
                    y: selRect.top - wrapperRect.top - 4,
                })
            }
        } catch {}
    }

    const handleAskAboutSelection = () => {
        if (!pdf?.selectedText) return
        const q = `Can you explain this passage from "${pdf.fileName}"?\n\n"${pdf.selectedText.slice(0, 400)}${pdf.selectedText.length > 400 ? "…" : ""}"`
        setInput(q)
        setSelectionTooltip(null)
        window.getSelection()?.removeAllRanges()
        setPdf(p => p ? { ...p, selectedText: "" } : p)
        setView("chat")
        setTimeout(() => inputRef.current?.focus(), 50)
    }

    // ── Interrupt ─────────────────────────────────────────────────────────────
    const interrupt = () => {
        abortRef.current = true
        if (currentAudioRef.current) { currentAudioRef.current.pause(); currentAudioRef.current = null }
        lipSyncRef.current.isActive = false
        lipSyncRef.current.audioElement = null
        lipSyncRef.current.analyser = null
        lipSyncRef.current.analyserBuffer = null
        onTalkingStateChange(false); onMoodChange("neutral")
        setIsSpeaking(false); setIsLoading(false); onVisualizerStateChange("idle")
        setTimeout(() => inputRef.current?.focus(), 0)
    }

    const analyzeText = (fullText: string): ScriptItem[] =>
        (fullText.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [fullText]).map(s => {
            const t = s.trim()
            let mood: AvatarMood = 'neutral'
            if (t.includes("!") || /wow|great/i.test(t)) mood = 'happy'
            else if (t.includes("?") || /what|hmm/i.test(t)) mood = 'surprise'
            else if (/sorry|sad|serious/i.test(t)) mood = 'serious'
            return { text: t, mood }
        })

    const expandNotation = (s: string) =>
        s.replace(/\bdet\(([^)]+)\)/g, 'the determinant of $1')
         .replace(/\bsqrt\(([^)]+)\)/g, 'the square root of $1')
         .replace(/(\w+)\^2\b/g, '$1 squared').replace(/(\w+)\^3\b/g, '$1 cubed')
         .replace(/\bO\(n\s*log\s*n\)/g, 'order n log n').replace(/\bO\(n\^2\)/g, 'order n squared')
         .replace(/\bO\(n\)/g, 'order n').replace(/\bO\(1\)/g, 'order 1')
         .replace(/!=/g, ' is not equal to ').replace(/==/g, ' equals ')
         .replace(/>=/g, ' greater than or equal to ').replace(/<=/g, ' less than or equal to ')
         .replace(/\\\[|\\\]|\$\$|\$/g, '')
         .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '$1 over $2')
         .replace(/\\sum/g, 'the sum of').replace(/\\int/g, 'the integral of')
         .replace(/\\infty/g, 'infinity').replace(/\\alpha/g, 'alpha').replace(/\\beta/g, 'beta')
         .replace(/\\theta/g, 'theta').replace(/\\lambda/g, 'lambda').replace(/\\pi/g, 'pi')
         .replace(/\\\w+/g, '')

    const toSpokenScript = (md: string): string => {
        let s = md
        s = s.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang) => ` [${lang ?? 'code'} block] `)
        s = s.replace(/`([^`]+)`/g, (_, i) => expandNotation(i))
        s = expandNotation(s)
        s = s.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/^#{1,6}\s+/gm, '')
        s = s.replace(/(\*\*|__)(.*?)\1/g, '$2').replace(/(\*|_)(.*?)\1/g, '$2')
        s = s.replace(/~~(.*?)~~/g, '$1').replace(/^\s*[-*+]\s+/gm, '').replace(/^\s*\d+\.\s+/gm, '')
        s = s.replace(/^\s*>\s?/gm, '').replace(/^---+$/gm, '').replace(/\|/g, ' ')
        s = s.replace(/\betc\.?\b/gi, 'and so on').replace(/\bi\.e\.?\b/gi, 'that is').replace(/\be\.g\.?\b/gi, 'for example')
        s = s.replace(/\n{2,}/g, '. ').replace(/\n/g, ' ').replace(/\s{2,}/g, ' ').replace(/\.\s*\./g, '.')
        return s.trim()
    }

    // ── Streaming chunked TTS ─────────────────────────────────────────────────
    const fetchTTS = (text: string) =>
        fetch("/api/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
        }).then(r => r.json()).catch(() => ({ error: "TTS failed" }))

    const playSingleItem = (item: ScriptItem, tts: any): Promise<void> =>
        new Promise(resolve => {
            if (tts.error || !tts.audioBase64) { resolve(); return }
            onMoodChange(item.mood)
            const { timeline, totalDuration } = computeTimeline(item.text, 1.0)
            const bytes = Uint8Array.from(atob(tts.audioBase64), c => c.charCodeAt(0))
            const url = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }))
            const audio = new Audio(url)
            currentAudioRef.current = audio
            let analyser: AnalyserNode | null = null, analyserBuffer: Uint8Array | null = null
            try { const r = createAnalyserForAudio(audio); analyser = r.analyser; analyserBuffer = r.buffer } catch {}
            audio.onloadedmetadata = () => {
                if (lipSyncRef.current.isActive && isFinite(audio.duration) && audio.duration > 0)
                    lipSyncRef.current.timeline = stretchTimeline(timeline, totalDuration, audio.duration)
            }
            audio.onplay = () => {
                onTalkingStateChange(true); onVisualizerStateChange("speaking")
                const dur = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : totalDuration
                lipSyncRef.current = { timeline: stretchTimeline(timeline, totalDuration, dur), totalDuration: dur, startTime: performance.now(), isActive: true, audioElement: audio, analyser, analyserBuffer }
            }
            const cleanup = () => {
                onTalkingStateChange(false); onVisualizerStateChange("idle")
                lipSyncRef.current.isActive = false; lipSyncRef.current.audioElement = null
                lipSyncRef.current.analyser = null; lipSyncRef.current.analyserBuffer = null
                if (currentAudioRef.current === audio) currentAudioRef.current = null
                URL.revokeObjectURL(url); resolve()
            }
            audio.onended = cleanup
            audio.onerror = () => { console.error("Audio error"); cleanup() }
            audio.play().catch(() => cleanup())
        })

    const playScript = async (script: ScriptItem[]) => {
        abortRef.current = false; setIsSpeaking(true)
        let nextFetch = fetchTTS(script[0].text)
        for (let i = 0; i < script.length; i++) {
            if (abortRef.current) break
            const tts = await nextFetch
            if (abortRef.current) break
            if (i + 1 < script.length) nextFetch = fetchTTS(script[i + 1].text)
            await playSingleItem(script[i], tts)
            if (i < script.length - 1 && !abortRef.current) await new Promise(r => setTimeout(r, 120))
        }
        if (!abortRef.current) {
            onTalkingStateChange(false); onMoodChange("neutral")
            onVisualizerStateChange("idle"); setIsSpeaking(false); setIsLoading(false)
        }
    }

    // ── Build messages with PDF context ───────────────────────────────────────
    const buildMessages = (history: Message[], userMsg: Message) => {
        if (!pdf) return [...history, userMsg]
        const MAX = 6000
        const fullText = pdf.extractedText.join("\n\n--- Page Break ---\n\n")
        const parts = fullText.split("--- Page Break ---")
        const pi = pdf.currentPage - 1
        const relevant = parts.slice(Math.max(0, pi - 1), pi + 3).join("--- Page Break ---")
        const ctx = relevant.length > MAX ? relevant.slice(0, MAX) + "… [truncated]" : relevant
        const sysContent = pdf.selectedText
            ? `PDF: "${pdf.fileName}" (page ${pdf.currentPage}/${pdf.numPages})\nSelected passage:\n"""\n${pdf.selectedText}\n"""\nDocument context:\n${ctx}`
            : `PDF: "${pdf.fileName}" (page ${pdf.currentPage}/${pdf.numPages})\nDocument context:\n${ctx}`
        const ctxMsg: Message = { role: "user", content: `[DOCUMENT CONTEXT]\n${sysContent}\n[END CONTEXT]` }
        const ackMsg: Message = { role: "assistant", content: "I have read the document and will use it to answer." }
        return [ctxMsg, ackMsg, ...history.slice(-6), userMsg]
    }

    // ── Submit ────────────────────────────────────────────────────────────────
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!input.trim() || (isLoading && !isSpeaking)) return
        // Always interrupt if already speaking (auto-pause on new query)
        if (isSpeaking) interrupt()
        // Only switch to chat if no PDF is open; if PDF is open, stay in PDF view
        // so the user can keep reading while David thinks/answers
        if (!pdf) setView("chat")

        let userText = input.trim()
        if (pdf?.selectedText) {
            userText = `About this excerpt: "${pdf.selectedText.slice(0, 300)}…" — ${userText}`
            setPdf(p => p ? { ...p, selectedText: "" } : p)
        }

        const userMessage: Message = { role: "user", content: userText }
        setMessages(prev => [...prev, userMessage])
        setInput(""); setIsLoading(true); onVisualizerStateChange("thinking")

        try {
            const res = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    provider,
                    model: provider === "ollama" ? "llama3.1:8b" : "llama-3.3-70b-versatile",
                    messages: buildMessages(messages, userMessage),
                }),
            })
            const data = await res.json()
            if (data.error) throw new Error(data.error)
            setMessages(prev => [...prev, { role: "assistant", content: data.content }])
            const localScript = toSpokenScript(data.content)
            const nr = await fetch("/api/narrate", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ provider, model: provider === "ollama" ? "llama3.1:8b" : "llama-3.3-70b-versatile", content: localScript }),
            })
            const nd = await nr.json()
            await playScript(analyzeText(nd.script ?? localScript))
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Connection failed."
            setMessages(prev => [...prev, { role: "assistant", content: msg }])
            setIsLoading(false); setIsSpeaking(false); onVisualizerStateChange("idle")
        }
    }

    return (
        <Card
            className={`flex flex-col h-full w-full border-border bg-card shadow-sm overflow-hidden rounded-xl max-lg:border-0 max-lg:shadow-none max-lg:bg-transparent max-lg:rounded-none pb-0 transition-all ${isDragging ? "ring-2 ring-primary/50" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f) loadPDF(f) }}
        >
            {/* ── Header ── */}
            <div className="flex-none px-4 py-3 border-b border-border flex items-center gap-2 max-lg:hidden">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <Bot className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                    <h2 className="text-sm font-semibold text-foreground">SchoolMe : David</h2>
                    <p className="text-xs text-muted-foreground truncate">
                        {pdf ? pdf.fileName : "Deepgram TTS · Chunked streaming"}
                    </p>
                </div>

                {/* PDF / Chat toggle */}
                {pdf && (
                    <div className="flex items-center gap-1 bg-muted/50 rounded-full p-0.5 shrink-0">
                        <button type="button" onClick={() => setView("pdf")}
                            className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${view === "pdf" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                            <FileText className="w-3 h-3" /> PDF
                        </button>
                        <button type="button" onClick={() => setView("chat")}
                            className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${view === "chat" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                            <MessageSquare className="w-3 h-3" /> Chat
                        </button>
                    </div>
                )}

                {pdf && (
                    <button type="button" onClick={closePDF} title="Close PDF"
                        className="text-muted-foreground hover:text-destructive p-1 rounded transition-colors shrink-0">
                        <X className="w-4 h-4" />
                    </button>
                )}

                {/* Provider toggle */}
                <div className="flex items-center gap-1 bg-muted/50 rounded-full p-0.5 shrink-0">
                    {(["ollama", "groq"] as LLMProvider[]).map(p => (
                        <button key={p} type="button" onClick={() => setProvider(p)}
                            className={`px-3 py-1 rounded-full text-xs font-medium capitalize transition-all ${provider === p ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                            {p}
                        </button>
                    ))}
                </div>
            </div>

            {/* ── Body ── */}
            <div className="flex-1 min-h-0 overflow-hidden relative max-lg:hidden">

                {/* ════ PDF VIEW ════ */}
                {view === "pdf" && pdf && (
                    <div className="h-full flex flex-col">
                        {/* Page nav */}
                        <div className="flex-none flex items-center justify-between px-4 py-2 border-b border-border bg-muted/20">
                            <button disabled={pdf.currentPage <= 1} onClick={() => goToPage(-1)}
                                className="p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                                <ChevronLeft className="w-4 h-4" />
                            </button>
                            <span className="text-xs font-medium text-muted-foreground">
                                Page {pdf.currentPage} of {pdf.numPages}
                            </span>
                            <button disabled={pdf.currentPage >= pdf.numPages} onClick={() => goToPage(1)}
                                className="p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                                <ChevronRight className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Scrollable canvas area */}
                        <div className="flex-1 overflow-auto bg-neutral-200"
                            ref={pdfContainerRef}
                            onMouseUp={handleTextLayerMouseUp}>
                            <div className="relative mx-auto my-4"
                                ref={canvasWrapperRef}
                                style={{ width: "fit-content" }}>
                                {/* Rendered PDF page */}
                                <canvas ref={canvasRef}
                                    className="block shadow-md rounded-sm bg-white" />

                                {/* Transparent selectable text layer — positioned to exactly
                                    overlay the canvas. top/left/width/height are set by renderPage(). */}
                                <div ref={textLayerRef}
                                    className="schoolme-text-layer select-text"
                                    style={{
                                        position: "absolute",
                                        top: 0,
                                        left: 0,
                                        overflow: "hidden",
                                        lineHeight: 1,
                                        userSelect: "text",
                                        WebkitUserSelect: "text",
                                        cursor: "text",
                                        pointerEvents: "all",
                                    }} />

                                {/* Selection tooltip — coords relative to this inner div */}
                                {selectionTooltip && (
                                    <div className="absolute z-50 pointer-events-auto"
                                        style={{
                                            left: selectionTooltip.x,
                                            top: selectionTooltip.y,
                                            transform: "translate(-50%, -100%)",
                                        }}>
                                        <button
                                            onMouseDown={(e) => { e.preventDefault(); handleAskAboutSelection() }}
                                            className="flex items-center gap-1.5 bg-primary text-primary-foreground text-xs font-medium px-3 py-1.5 rounded-full shadow-lg hover:bg-primary/90 transition-colors whitespace-nowrap">
                                            <MessageSquareQuote className="w-3.5 h-3.5" />
                                            Ask David about this
                                        </button>
                                        <div className="w-2 h-2 bg-primary rotate-45 mx-auto -mt-1 rounded-sm" />
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Selected text strip */}
                        {pdf.selectedText && (
                            <div className="flex-none px-4 py-2 border-t border-primary/20 bg-primary/5 flex items-center gap-2">
                                <div className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                                <p className="text-[11px] text-primary/80 flex-1 truncate">
                                    "{pdf.selectedText.slice(0, 90)}{pdf.selectedText.length > 90 ? "…" : ""}"
                                </p>
                                <button onClick={handleAskAboutSelection}
                                    className="text-[11px] text-primary font-semibold hover:underline shrink-0">
                                    Ask David →
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* ════ CHAT VIEW ════ */}
                {view === "chat" && (
                    <ScrollArea className="h-full w-full p-4" ref={scrollRef}>
                        <div className="space-y-6 pb-4">
                            {messages.length === 0 && (
                                <div className="flex flex-col items-center justify-center text-center mt-20 opacity-50">
                                    <Bot className="w-12 h-12 text-muted-foreground mb-4" />
                                    <p className="text-muted-foreground text-sm">
                                        {pdf ? `PDF loaded — ask David anything about "${pdf.fileName}".` : "Say hello to start the conversation."}
                                    </p>
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
                                            <div className="prose prose-sm prose-neutral max-w-none [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_pre]:my-2 [&_pre]:bg-neutral-100 [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_code]:text-xs [&_code]:bg-neutral-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_pre_code]:bg-transparent [&_h1]:text-base [&_h2]:text-sm [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_table]:text-xs [&_th]:px-2 [&_th]:py-1 [&_td]:px-2 [&_td]:py-1 [&_a]:text-primary [&_a]:underline">
                                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                                            </div>
                                        ) : msg.content}
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
                )}

                {/* PDF loading overlay */}
                {pdfLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-20">
                        <div className="text-center">
                            <Loader2 className="w-8 h-8 text-primary animate-spin mx-auto mb-2" />
                            <p className="text-sm text-muted-foreground">Loading PDF…</p>
                        </div>
                    </div>
                )}

                {/* Drag overlay */}
                {isDragging && (
                    <div className="absolute inset-0 flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary/40 z-20 m-2 rounded-xl">
                        <div className="text-center">
                            <FileText className="w-10 h-10 text-primary mx-auto mb-2" />
                            <p className="text-sm font-medium text-primary">Drop PDF to open</p>
                        </div>
                    </div>
                )}
            </div>

            {/* ── Input bar ── */}
            <div className="flex-none p-3 pb-5 lg:p-4 max-lg:bg-background/80 max-lg:backdrop-blur-md lg:bg-card lg:border-t border-border">
                {/* Mobile provider toggle */}
                <div className="flex items-center justify-between mb-2 lg:hidden">
                    <div className="flex items-center gap-2">
                        <Bot className="w-4 h-4 text-primary" />
                        <span className="text-xs font-medium text-foreground">David</span>
                    </div>
                    <div className="flex items-center gap-1 bg-muted/50 rounded-full p-0.5">
                        {(["ollama", "groq"] as LLMProvider[]).map(p => (
                            <button key={p} type="button" onClick={() => setProvider(p)}
                                className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium capitalize transition-all ${provider === p ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}>
                                {p}
                            </button>
                        ))}
                    </div>
                </div>

                {pdfError && <p className="text-xs text-destructive mb-2 px-1">{pdfError}</p>}

                <form onSubmit={handleSubmit} className="flex gap-2 items-center relative">
                    <Input
                        ref={inputRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder={
                            pdf?.selectedText ? "Ask David about selected text…"
                            : pdf ? `Ask about ${pdf.fileName}…`
                            : isSpeaking ? "Type to interrupt..."
                            : "Ask anything… or drop a PDF"
                        }
                        className="pr-24 py-6 bg-muted/20 border-border focus-visible:ring-primary/20 rounded-full transition-all"
                        disabled={isLoading && !isSpeaking}
                    />

                    {/* Stop button — visible while speaking */}
                    {isSpeaking && (
                        <Button type="button" onClick={interrupt} size="icon" variant="ghost"
                            className="absolute right-20 top-1.5 h-9 w-9 rounded-full text-destructive hover:bg-destructive/10 transition-all"
                            title="Stop speaking">
                            <StopCircle className="w-5 h-5" />
                        </Button>
                    )}

                    {/* PDF upload — right side, next to send */}
                    <button type="button" onClick={() => fileInputRef.current?.click()}
                        title={pdf ? pdf.fileName : "Upload PDF"}
                        className={`absolute right-11 top-1.5 h-9 w-9 flex items-center justify-center rounded-full transition-all ${pdf ? "text-primary bg-primary/10 hover:bg-primary/20" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}>
                        <Paperclip className="w-4 h-4" />
                    </button>

                    <Button type="submit"
                        disabled={(isLoading && !isSpeaking) || !input.trim()}
                        size="icon"
                        className="absolute right-1.5 top-1.5 h-9 w-9 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground transition-all">
                        <Send className="w-4 h-4" />
                    </Button>
                </form>

                <input ref={fileInputRef} type="file" accept=".pdf" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) loadPDF(f); e.target.value = "" }} />
            </div>
        </Card>
    )
}