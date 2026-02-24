// components/PDFPanel.tsx
"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { Upload, FileText, X, ChevronLeft, ChevronRight, MessageSquareQuote, BookOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Card } from "@/components/ui/card"

export type PDFContext = {
  fileName: string
  fullText: string      // entire extracted text (for context in chat)
  selectedText: string  // currently selected passage (may be empty)
  currentPage: number
}

interface PDFPanelProps {
  onContextChange: (ctx: PDFContext | null) => void
  onAskAboutSelection: (selectedText: string) => void
}

// ── Tiny PDF text extractor using PDF.js loaded from CDN ──────────────────────
// We load it lazily so it doesn't bloat the main bundle.
async function extractTextFromPDF(file: File): Promise<{ pages: string[] }> {
  // Dynamically load PDF.js from CDN if not already loaded
  if (!(window as any).pdfjsLib) {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script")
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"
      script.onload = () => resolve()
      script.onerror = () => reject(new Error("Failed to load PDF.js"))
      document.head.appendChild(script)
    })
    ;(window as any).pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"
  }

  const pdfjsLib = (window as any).pdfjsLib
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const pages: string[] = []

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const pageText = content.items
      .map((item: any) => item.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
    pages.push(pageText)
  }

  return { pages }
}

export default function PDFPanel({ onContextChange, onAskAboutSelection }: PDFPanelProps) {
  const [isOpen, setIsOpen] = useState(true)
  const [fileName, setFileName] = useState<string | null>(null)
  const [pages, setPages] = useState<string[]>([])
  const [currentPage, setCurrentPage] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [selectedText, setSelectedText] = useState("")
  const [selectionTooltip, setSelectionTooltip] = useState<{ x: number; y: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textAreaRef = useRef<HTMLDivElement>(null)

  // Notify parent whenever context changes
  useEffect(() => {
    if (!fileName || pages.length === 0) {
      onContextChange(null)
      return
    }
    onContextChange({
      fileName,
      fullText: pages.join("\n\n--- Page Break ---\n\n"),
      selectedText,
      currentPage: currentPage + 1,
    })
  }, [fileName, pages, selectedText, currentPage, onContextChange])

  const handleFile = async (file: File) => {
    if (!file.name.endsWith(".pdf")) {
      setError("Please upload a PDF file.")
      return
    }
    setError(null)
    setIsLoading(true)
    setSelectedText("")
    setSelectionTooltip(null)

    try {
      const { pages: extractedPages } = await extractTextFromPDF(file)
      setPages(extractedPages)
      setFileName(file.name)
      setCurrentPage(0)
    } catch (e) {
      setError("Could not read PDF. Please try another file.")
      console.error(e)
    } finally {
      setIsLoading(false)
    }
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [])

  const handleMouseUp = () => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) {
      setSelectedText("")
      setSelectionTooltip(null)
      return
    }
    const text = selection.toString().trim()
    if (!text || text.length < 5) {
      setSelectedText("")
      setSelectionTooltip(null)
      return
    }

    // Check selection is within our text area
    if (textAreaRef.current && !textAreaRef.current.contains(selection.anchorNode)) {
      return
    }

    setSelectedText(text)

    // Position tooltip near selection
    const range = selection.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    const panelRect = textAreaRef.current?.getBoundingClientRect()
    if (panelRect) {
      setSelectionTooltip({
        x: rect.left + rect.width / 2 - panelRect.left,
        y: rect.top - panelRect.top - 8,
      })
    }
  }

  const handleAskAboutSelection = () => {
    if (selectedText) {
      onAskAboutSelection(selectedText)
      setSelectionTooltip(null)
      window.getSelection()?.removeAllRanges()
      setSelectedText("")
    }
  }

  const clearPDF = () => {
    setFileName(null)
    setPages([])
    setCurrentPage(0)
    setSelectedText("")
    setSelectionTooltip(null)
    setError(null)
    onContextChange(null)
  }

  // Collapsed sidebar
  if (!isOpen) {
    return (
      <div className="flex flex-col items-center py-4 px-2 gap-3 border-r border-border bg-card h-full">
        <button
          onClick={() => setIsOpen(true)}
          className="text-muted-foreground hover:text-foreground transition-colors"
          title="Open PDF Panel"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
        <BookOpen className="w-5 h-5 text-muted-foreground/50 mt-2" />
        {fileName && (
          <div
            className="w-2 h-2 rounded-full bg-primary mt-1"
            title={`PDF loaded: ${fileName}`}
          />
        )}
      </div>
    )
  }

  return (
    <Card className="flex flex-col h-full border-r border-border rounded-none bg-card shadow-none">
      {/* Header */}
      <div className="flex-none px-3 py-3 border-b border-border flex items-center gap-2">
        <BookOpen className="w-4 h-4 text-primary shrink-0" />
        <span className="text-sm font-semibold text-foreground flex-1 truncate">
          {fileName ? fileName : "PDF Reader"}
        </span>
        <div className="flex items-center gap-1">
          {fileName && (
            <button
              onClick={clearPDF}
              className="text-muted-foreground hover:text-destructive transition-colors p-1 rounded"
              title="Remove PDF"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => setIsOpen(false)}
            className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded"
            title="Collapse panel"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 relative">
        {!fileName ? (
          /* Drop zone */
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            className="h-full flex flex-col items-center justify-center p-4 gap-4 border-2 border-dashed border-border/50 m-3 rounded-xl cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-all"
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
              <Upload className="w-5 h-5 text-primary" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-foreground mb-1">Upload a PDF</p>
              <p className="text-xs text-muted-foreground">Drag & drop or click to browse</p>
            </div>
            {error && (
              <p className="text-xs text-destructive text-center">{error}</p>
            )}
            {isLoading && (
              <p className="text-xs text-primary animate-pulse">Reading PDF…</p>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleFile(file)
              }}
            />
          </div>
        ) : isLoading ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <FileText className="w-8 h-8 text-primary/50 mx-auto mb-2 animate-pulse" />
              <p className="text-xs text-muted-foreground">Extracting text…</p>
            </div>
          </div>
        ) : (
          /* PDF text display with selection support */
          <div className="h-full flex flex-col">
            <div ref={textAreaRef} className="flex-1 min-h-0 relative" onMouseUp={handleMouseUp}>
              <ScrollArea className="h-full">
                <div className="p-4">
                  <div className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                    <FileText className="w-3 h-3" />
                    Page {currentPage + 1} of {pages.length}
                  </div>
                  <p className="text-[13px] leading-relaxed text-foreground whitespace-pre-wrap select-text font-sans">
                    {pages[currentPage] || "(No text found on this page)"}
                  </p>
                  {selectedText && (
                    <p className="mt-3 text-[11px] text-primary/70 italic">
                      {selectedText.length} characters selected — use the button above to ask David
                    </p>
                  )}
                </div>
              </ScrollArea>

              {/* Selection tooltip */}
              {selectionTooltip && selectedText && (
                <div
                  className="absolute z-50 transform -translate-x-1/2 -translate-y-full pointer-events-auto"
                  style={{ left: selectionTooltip.x, top: selectionTooltip.y }}
                >
                  <button
                    onMouseDown={(e) => {
                      e.preventDefault() // Don't lose selection
                      handleAskAboutSelection()
                    }}
                    className="flex items-center gap-1.5 bg-primary text-primary-foreground text-xs font-medium px-3 py-1.5 rounded-full shadow-lg hover:bg-primary/90 transition-colors whitespace-nowrap"
                  >
                    <MessageSquareQuote className="w-3.5 h-3.5" />
                    Ask David about this
                  </button>
                  <div className="w-2 h-2 bg-primary rotate-45 mx-auto -mt-1 rounded-sm" />
                </div>
              )}
            </div>

            {/* Page navigation */}
            {pages.length > 1 && (
              <div className="flex-none flex items-center justify-between px-3 py-2 border-t border-border">
                <button
                  disabled={currentPage === 0}
                  onClick={() => { setCurrentPage(p => p - 1); setSelectedText(""); setSelectionTooltip(null) }}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors p-1 rounded"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs text-muted-foreground">
                  {currentPage + 1} / {pages.length}
                </span>
                <button
                  disabled={currentPage === pages.length - 1}
                  onClick={() => { setCurrentPage(p => p + 1); setSelectedText(""); setSelectionTooltip(null) }}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors p-1 rounded"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Ask about full PDF button */}
            <div className="flex-none px-3 pb-3">
              <button
                onClick={() => {
                  onContextChange({
                    fileName: fileName!,
                    fullText: pages.join("\n\n--- Page Break ---\n\n"),
                    selectedText: "",
                    currentPage: currentPage + 1,
                  })
                }}
                className="w-full text-[11px] text-primary/70 hover:text-primary border border-primary/20 hover:border-primary/40 rounded-lg py-1.5 transition-all hover:bg-primary/5"
              >
                PDF context active — queries use this document
              </button>
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}