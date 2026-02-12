// components/ChatInterface.tsx
"use client"

import { useState, useRef, useEffect } from "react"
import { Send, Bot, User, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Card } from "@/components/ui/card"
import { AvatarMood } from "./Avatars/david"
import { type LipSyncData, computeTimeline } from "@/lib/lipSync"
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
    lipSyncRef: React.MutableRefObject<LipSyncData>
}

export default function ChatInterface({ onTalkingStateChange, onMoodChange, lipSyncRef }: ChatInterfaceProps) {
    const [messages, setMessages] = useState<Message[]>([])
    const [input, setInput] = useState("")
    const [isLoading, setIsLoading] = useState(false)
    const [voice, setVoice] = useState<SpeechSynthesisVoice | null>(null)
    const [provider, setProvider] = useState<LLMProvider>("ollama")
    const scrollRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const loadVoices = () => {
            const voices = window.speechSynthesis.getVoices()
            const preferredVoice = voices.find(v => v.name.includes("David")) || 
                                   voices.find(v => v.name.includes("Mark")) || 
                                   voices.find(v => v.name.includes("Male")) || 
                                   voices[0]
            setVoice(preferredVoice)
        }
        if (window.speechSynthesis.getVoices().length > 0) loadVoices()
        else window.speechSynthesis.onvoiceschanged = loadVoices
        return () => { window.speechSynthesis.onvoiceschanged = null }
    }, [])

    useEffect(() => {
        if (scrollRef.current) {
            const viewport = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]')
            if (viewport) {
                (viewport as HTMLElement).scrollTop = (viewport as HTMLElement).scrollHeight
            }
        }
    }, [messages])

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

    const playScript = (script: ScriptItem[]) => {
        if (!window.speechSynthesis || !voice) return
        window.speechSynthesis.cancel()
        let currentIndex = 0

        const speakNext = () => {
            if (currentIndex >= script.length) {
                onTalkingStateChange(false)
                onMoodChange('neutral')
                lipSyncRef.current.isActive = false
                return
            }
            const item = script[currentIndex]
            onMoodChange(item.mood)

            // Build viseme timeline for this sentence
            const { timeline, charTimeMap, totalDuration } = computeTimeline(item.text, 1.0)

            const utterance = new SpeechSynthesisUtterance(item.text)
            utterance.voice = voice
            utterance.rate = 1.0

            utterance.onstart = () => {
                onTalkingStateChange(true)
                lipSyncRef.current = {
                    timeline,
                    charTimeMap,
                    totalDuration,
                    startTime: performance.now(),
                    isActive: true,
                }
            }

            // Re-calibrate lip-sync clock on every word boundary
            utterance.onboundary = (event) => {
                if (event.name === 'word' && lipSyncRef.current.isActive) {
                    const timeForChar = charTimeMap[event.charIndex]
                    if (timeForChar !== undefined) {
                        lipSyncRef.current.startTime = performance.now() - timeForChar * 1000
                    }
                }
            }

            utterance.onend = () => {
                onTalkingStateChange(false)
                lipSyncRef.current.isActive = false
                currentIndex++
                setTimeout(speakNext, 250) 
            }
            utterance.onerror = () => {
                onTalkingStateChange(false)
                lipSyncRef.current.isActive = false
                console.error("TTS Error")
            }
            window.speechSynthesis.speak(utterance)
        }
        speakNext()
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!input.trim() || isLoading) return
        const userMessage: Message = { role: "user", content: input }
        setMessages(prev => [...prev, userMessage])
        setInput("")
        setIsLoading(true)

        try {
            const response = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    provider,
                    model: provider === "ollama" ? "phi:latest" : "llama-3.3-70b-versatile",
                    messages: [...messages, userMessage],
                }),
            })
            const data = await response.json()
            if (data.error) throw new Error(data.error)
            const textResponse = data.content
            const botMessage: Message = { role: "assistant", content: textResponse }
            setMessages(prev => [...prev, botMessage])
            const script = analyzeText(textResponse)
            playScript(script)
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : "Connection failed."
            setMessages(prev => [...prev, { role: "assistant", content: errorMsg }])
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <Card className="flex flex-col h-full w-full border-border bg-card shadow-sm overflow-hidden rounded-xl">
            <div className="flex-none pb-4 px-4 border-b border-border flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <Bot className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1">
                    <h2 className="text-sm font-semibold text-foreground">SchoolMe : David</h2>
                    <p className="text-xs text-muted-foreground">{voice ? "Voice Active" : "Loading..."}</p>
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

            <div className="flex-1 min-h-0 overflow-hidden relative">
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
                        {isLoading && (
                            <div className="flex justify-start gap-3">
                                <div className="w-8 h-8 rounded-full border bg-muted flex items-center justify-center shrink-0"><Bot className="w-4 h-4 text-muted-foreground"/></div>
                                <div className="bg-muted/50 rounded-2xl rounded-tl-none px-4 py-3 flex items-center gap-2">
                                    <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" /><span className="text-xs text-muted-foreground">Thinking...</span>
                                </div>
                            </div>
                        )}
                    </div>
                </ScrollArea>
            </div>

            <div className="flex-none p-4 bg-card border-t border-border">
                <form onSubmit={handleSubmit} className="flex gap-2 items-center relative">
                    <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask anything..." className="pr-12 py-6 bg-muted/20 border-border focus-visible:ring-primary/20 rounded-full" disabled={isLoading} />
                    <Button type="submit" disabled={isLoading || !input.trim()} size="icon" className="absolute right-1.5 top-1.5 h-9 w-9 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground"><Send className="w-4 h-4" /></Button>
                </form>
            </div>
        </Card>
    )
}