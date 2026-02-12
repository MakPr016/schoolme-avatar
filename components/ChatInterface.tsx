"use client"

import { useState, useRef, useEffect } from "react"
import { Send, Bot, User, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Card } from "@/components/ui/card"

type Message = {
  role: "user" | "assistant"
  content: string
}

type ChatInterfaceProps = {
  onTalkingStateChange: (isTalking: boolean) => void
}

export default function ChatInterface({ onTalkingStateChange }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const speakText = (text: string) => {
    if (!window.speechSynthesis) return
    window.speechSynthesis.cancel()

    const utterance = new SpeechSynthesisUtterance(text)
    const voices = window.speechSynthesis.getVoices()
    // Try to pick a pleasant voice
    const preferredVoice = voices.find(v => v.name.includes("Male") || v.name.includes("David")) || voices[0]
    if (preferredVoice) utterance.voice = preferredVoice

    utterance.onstart = () => onTalkingStateChange(true)
    utterance.onend = () => onTalkingStateChange(false)
    utterance.onerror = () => onTalkingStateChange(false)

    window.speechSynthesis.speak(utterance)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return

    const userMessage: Message = { role: "user", content: input }
    setMessages(prev => [...prev, userMessage])
    setInput("")
    setIsLoading(true)

    try {
      // Connects to local Ollama instance
      const response = await fetch("http://localhost:11434/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "phi:latest",
          messages: [...messages, userMessage],
          stream: false
        }),
      })

      const data = await response.json()
      const botMessage: Message = { role: "assistant", content: data.message.content }
      
      setMessages(prev => [...prev, botMessage])
      speakText(botMessage.content)
      
    } catch (error) {
      console.error("Ollama Error:", error)
      const errorMessage: Message = { role: "assistant", content: "I'm having trouble connecting to my brain (Ollama)." }
      setMessages(prev => [...prev, errorMessage])
      speakText("I'm having trouble connecting to my brain.")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Card className="flex flex-col h-full border-border bg-card shadow-sm overflow-hidden rounded-xl">
      {/* Header */}
      <div className="p-4 border-b border-border bg-muted/30 flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
            <Bot className="w-5 h-5 text-primary" />
        </div>
        <div>
            <h2 className="text-sm font-semibold text-foreground">David AI</h2>
            <p className="text-xs text-muted-foreground">Powered by Phi & R3F</p>
        </div>
      </div>

      {/* Messages Area */}
      <ScrollArea className="flex-1 p-4 bg-background/50" ref={scrollRef}>
        <div className="space-y-6">
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center mt-20 opacity-50">
              <Bot className="w-12 h-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground text-sm">Say hello to start the conversation.</p>
            </div>
          )}
          
          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`flex gap-3 ${
                msg.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
               {/* Avatar for Bot */}
              {msg.role === "assistant" && (
                <div className="w-8 h-8 rounded-full border border-border bg-muted flex items-center justify-center shrink-0 mt-1">
                  <Bot className="w-4 h-4 text-muted-foreground" />
                </div>
              )}
              
              <div
                className={`rounded-2xl px-5 py-3 text-sm max-w-[85%] shadow-sm ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground rounded-tr-none"
                    : "bg-white border border-border text-foreground rounded-tl-none"
                }`}
              >
                {msg.content}
              </div>

              {/* Avatar for User */}
              {msg.role === "user" && (
                <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center shrink-0 mt-1">
                  <User className="w-4 h-4 text-primary-foreground" />
                </div>
              )}
            </div>
          ))}
          
          {isLoading && (
            <div className="flex justify-start gap-3">
               <div className="w-8 h-8 rounded-full border border-border bg-muted flex items-center justify-center shrink-0">
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

      {/* Input Area - Clean & Simple */}
      <div className="p-4 bg-card border-t border-border">
        <form onSubmit={handleSubmit} className="flex gap-2 items-center relative">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask anything..."
            className="pr-12 py-6 bg-muted/20 border-border focus-visible:ring-primary/20 rounded-full"
            disabled={isLoading}
          />
          <Button 
            type="submit" 
            disabled={isLoading || !input.trim()}
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