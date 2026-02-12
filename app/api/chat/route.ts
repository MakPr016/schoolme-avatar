// app/api/chat/route.ts
import { NextRequest, NextResponse } from "next/server"

export async function POST(req: NextRequest) {
    const body = await req.json()
    const { provider, messages, model } = body

    if (provider === "groq") {
        return handleGroq(messages, model)
    }
    return handleOllama(messages, model)
}

async function handleOllama(
    messages: { role: string; content: string }[],
    model: string = "phi:latest"
) {
    try {
        const res = await fetch("http://localhost:11434/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model, messages, stream: false }),
        })
        if (!res.ok) {
            return NextResponse.json(
                { error: `Ollama error: ${res.status} ${res.statusText}` },
                { status: 502 }
            )
        }
        const data = await res.json()
        return NextResponse.json({ content: data.message.content })
    } catch {
        return NextResponse.json(
            { error: "Cannot reach Ollama. Make sure it is running on localhost:11434." },
            { status: 502 }
        )
    }
}

async function handleGroq(
    messages: { role: string; content: string }[],
    model: string = "llama-3.3-70b-versatile"
) {
    const apiKey = process.env.GROK_API_KEY
    if (!apiKey) {
        return NextResponse.json(
            { error: "GROK_API_KEY is not set in environment variables." },
            { status: 500 }
        )
    }

    try {
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({ model, messages, temperature: 0.7 }),
        })

        if (!res.ok) {
            const err = await res.text()
            return NextResponse.json(
                { error: `Groq API error: ${res.status} – ${err}` },
                { status: 502 }
            )
        }

        const data = await res.json()
        return NextResponse.json({
            content: data.choices[0].message.content,
        })
    } catch {
        return NextResponse.json(
            { error: "Failed to reach Groq API." },
            { status: 502 }
        )
    }
}
