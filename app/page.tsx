"use client"

import { useState, useRef } from "react"
import ChatInterface from "@/components/ChatInterface"
import ProfessorModel, { AvatarMood } from "@/components/Avatars/professor"
import AvatarVisualizer, { type VisualizerState } from "@/components/AvatarVisualizer"
import { type LipSyncData, createLipSyncData } from "@/lib/lipSync"

export default function Page() {
    const [isTalking, setIsTalking] = useState(false)
    const [mood, setMood] = useState<AvatarMood>('neutral')
    const [visualizerState, setVisualizerState] = useState<VisualizerState>("idle")
    const lipSyncRef = useRef<LipSyncData>(createLipSyncData())

    return (
        <main className="h-screen w-screen bg-background text-foreground overflow-hidden flex flex-col">
            <div className="flex-1 flex flex-col lg:grid lg:grid-cols-2 lg:gap-6 lg:p-6 h-full w-full lg:max-w-400 mx-auto relative">
                {/* Chat panel — now includes the PDF viewer */}
                <div className="max-lg:absolute max-lg:bottom-0 max-lg:left-0 max-lg:right-0 max-lg:z-10 lg:flex lg:h-full lg:flex-col lg:min-h-125">
                    <ChatInterface
                        onTalkingStateChange={setIsTalking}
                        onMoodChange={setMood}
                        onVisualizerStateChange={setVisualizerState}
                        lipSyncRef={lipSyncRef}
                    />
                </div>

                {/* Avatar panel */}
                <div className="flex-1 flex flex-col relative lg:min-h-125">
                    <ProfessorModel isTalking={isTalking} mood={mood} lipSyncRef={lipSyncRef} />

                    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10">
                        <AvatarVisualizer
                            state={visualizerState}
                            analyser={lipSyncRef.current.analyser}
                        />
                    </div>
                </div>
            </div>
        </main>
    )
}