// app/api/tts/route.ts — Deepgram Aura TTS
import { NextRequest, NextResponse } from "next/server"

const DEFAULT_MODEL = "aura-2-apollo-en" // deep male voice

export async function POST(req: NextRequest) {
    const apiKey = process.env.SCHOOLME_API_KEY
    if (!apiKey) {
        return NextResponse.json(
            { error: "SCHOOLME_API_KEY is not set." },
            { status: 500 }
        )
    }

    const { text, model } = await req.json()
    if (!text || typeof text !== "string") {
        return NextResponse.json(
            { error: "Missing 'text' in request body." },
            { status: 400 }
        )
    }

    const ttsModel = model || DEFAULT_MODEL

    try {
        const res = await fetch(
            `https://api.deepgram.com/v1/speak?model=${encodeURIComponent(ttsModel)}&encoding=mp3`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Token ${apiKey}`,
                },
                body: JSON.stringify({ text }),
            }
        )

        if (!res.ok) {
            const errBody = await res.text()
            return NextResponse.json(
                { error: `Deepgram API error ${res.status}: ${errBody}` },
                { status: 502 }
            )
        }

        // Deepgram returns raw audio bytes
        const audioBuffer = await res.arrayBuffer()
        const audioBase64 = Buffer.from(audioBuffer).toString("base64")

        return NextResponse.json({ audioBase64 })
    } catch {
        return NextResponse.json(
            { error: "Failed to reach Deepgram API." },
            { status: 502 }
        )
    }
}
