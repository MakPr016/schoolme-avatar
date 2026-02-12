# SchoolMe – David Avatar

An interactive 3D avatar assistant powered by LLMs (Ollama / Groq), Deepgram Aura TTS and viseme-based lip sync.

The avatar speaks responses aloud with accurate mouth movement driven by character-to-viseme mapping synced to audio playback, adjusts facial expressions per sentence, and renders LLM output as formatted Markdown.

## Features

- **3D Avatar** – Ready Player Me character rendered with React Three Fiber, with blinking, mood expressions and idle/talking animations.
- **Viseme Lip Sync** – Text is mapped to viseme morph targets (15 RPM blend shapes) and synced to `audio.currentTime` for frame-accurate mouth movement.
- **LLM Chat** – Switch between a local **Ollama** model and the cloud **Groq** API with a single click. Requests are proxied through a Next.js API route so keys stay server-side.
- **Deepgram Aura TTS** – High-quality male voice (Andromeda). All sentences are pre-fetched in parallel so transitions between sentences are near-instant.
- **Markdown Messages** – Assistant responses render with full GitHub-Flavoured Markdown (code blocks, tables, lists, links, etc.).
- **Responsive Layout** – Desktop shows chat + avatar side by side. Mobile shows the avatar full-screen with a floating input bar at the bottom.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Turbopack) |
| 3D | Three.js, React Three Fiber, Drei |
| TTS | Deepgram Aura (`/v1/speak`) |
| LLM | Ollama (local) / Groq (cloud) |
| Styling | Tailwind CSS 4, shadcn/ui |
| Markdown | react-markdown + remark-gfm |

## Getting Started

### Prerequisites

- Node.js ≥ 18
- A [Deepgram](https://console.deepgram.com) API key
- (Optional) [Ollama](https://ollama.com) running locally for the Ollama provider
- (Optional) A [Groq](https://console.groq.com) API key for the Groq provider

### Environment Variables

Create a `.env.local` in the project root:

```env
SCHOOLME_API_KEY=...           # Deepgram API key (required for TTS)
GROK_API_KEY=gsk_...           # optional – only needed for Groq provider
```

### Install & Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Avatar Model

Place your Ready Player Me `.glb` model at `public/avatars/david.glb`. The model should include standard RPM morph targets (`viseme_*`, `eyeBlinkLeft/Right`, `mouthSmile`, `browDownLeft/Right`, `browInnerUp`, `jawOpen`).

## Project Structure

```
app/
  page.tsx            – Main page (avatar + chat layout)
  api/chat/route.ts   – LLM proxy (Ollama / Groq)
  api/tts/route.ts    – Deepgram Aura TTS
components/
  ChatInterface.tsx   – Chat UI, provider toggle, markdown rendering
  Avatars/david.tsx   – 3D model, animations, viseme lip sync
lib/
  lipSync.ts          – Viseme mapping, timeline builders, morph-target helpers
public/
  avatars/            – GLB avatar models
  animations/         – GLB/FBX animation clips
```

## License

Private project.
