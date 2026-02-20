// app/api/narrate/route.ts
// Converts a raw LLM markdown response into a natural spoken script.
// Uses the same provider/model that generated the response so no new keys needed.
import { NextRequest, NextResponse } from "next/server"

const SYSTEM_PROMPT = `You are a script writer for a spoken AI tutor avatar named David.
Your job is to convert a markdown-formatted assistant response into natural spoken English 
that David will say out loud to the student.

Rules:
- Write ONLY what David should say — no stage directions, no labels, no quotes
- Speak like a knowledgeable teacher explaining to a student face-to-face, not reading a document
- Summarise long responses: hit the key points conversationally, skip exhaustive lists
- Never read markdown syntax (no asterisks, hashes, backticks, pipes)
- Convert all math/code into plain English:
    det(A) → "the determinant of A"
    x^2 → "x squared"
    O(n log n) → "order n log n"
    for i in range(n) → "a loop that runs n times"
    def foo() → "a function called foo"
    != → "is not equal to"
    >= → "is greater than or equal to"
    => → "implies"
    // comment → say what the comment says naturally
- Spell out abbreviations that sound odd aloud: e.g. "etc" → "and so on", "i.e." → "that is", "e.g." → "for example"
- Never say "In this response" or "As an AI" or refer to markdown structure
- If the response contains a code block, describe what it does briefly — don't attempt to read the code
- If the response contains a table, summarise the key takeaway from the table
- Match a natural speaking pace: avoid sentences longer than ~20 words
- Output plain text only — no markdown whatsoever`

export async function POST(req: NextRequest) {
    const { provider, model, content } = await req.json()

    if (!content || typeof content !== "string") {
        return NextResponse.json({ error: "Missing content" }, { status: 400 })
    }

    // For very short plain-text responses, skip the LLM call entirely
    const isSimple = content.length < 120 && !/[`#*|\\^_]/.test(content)
    if (isSimple) {
        return NextResponse.json({ script: content })
    }

    if (provider === "groq") {
        return narrateWithGroq(content, model)
    }
    return narrateWithOllama(content, model)
}

async function narrateWithOllama(content: string, model: string = "llama3.1:8b") {
    try {
        const res = await fetch("http://localhost:11434/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model,
                messages: [
                    { role: "system", content: SYSTEM_PROMPT },
                    { role: "user", content },
                ],
                stream: false,
            }),
        })
        if (!res.ok) {
            // Fall back to returning the raw content so TTS still works
            return NextResponse.json({ script: content, fallback: true })
        }
        const data = await res.json()
        return NextResponse.json({ script: data.message.content })
    } catch {
        return NextResponse.json({ script: content, fallback: true })
    }
}

async function narrateWithGroq(content: string, model: string = "llama-3.3-70b-versatile") {
    const apiKey = process.env.GROK_API_KEY
    if (!apiKey) {
        return NextResponse.json({ script: content, fallback: true })
    }
    try {
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model,
                messages: [
                    { role: "system", content: SYSTEM_PROMPT },
                    { role: "user", content },
                ],
                temperature: 0.3, // low temperature — we want consistent, clean output
                max_tokens: 600,  // spoken scripts should be concise
            }),
        })
        if (!res.ok) {
            return NextResponse.json({ script: content, fallback: true })
        }
        const data = await res.json()
        return NextResponse.json({ script: data.choices[0].message.content })
    } catch {
        return NextResponse.json({ script: content, fallback: true })
    }
}