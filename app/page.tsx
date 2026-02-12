"use client"

import { useState, useRef } from "react"
import ChatInterface from "@/components/ChatInterface"
import DavidModel, { AvatarMood } from "@/components/Avatars/david"
import { type LipSyncData, createLipSyncData } from "@/lib/lipSync"

export default function Page() {
    const [isTalking, setIsTalking] = useState(false)
    const [mood, setMood] = useState<AvatarMood>('neutral')
    const lipSyncRef = useRef<LipSyncData>(createLipSyncData())

    return (
        <main className="h-screen w-screen bg-background text-foreground overflow-hidden flex flex-col">
            <div className="flex-1 flex flex-col lg:grid lg:grid-cols-2 lg:gap-6 lg:p-6 h-full w-full lg:max-w-400 mx-auto relative">
                {/* Chat panel — full card on desktop, input-only overlay on mobile */}
                <div className="max-lg:absolute max-lg:bottom-0 max-lg:left-0 max-lg:right-0 max-lg:z-10 lg:flex lg:h-full lg:flex-col lg:min-h-125">
                    <ChatInterface 
                        onTalkingStateChange={setIsTalking} 
                        onMoodChange={setMood}
                        lipSyncRef={lipSyncRef}
                    />
                </div>

                {/* Avatar panel — full screen on mobile */}
                <div className="flex-1 flex flex-col relative lg:min-h-125">
                    <DavidModel isTalking={isTalking} mood={mood} lipSyncRef={lipSyncRef} />
                    
                    <div className={`absolute top-4 right-4 px-3 py-1.5 rounded-full text-xs font-medium border transition-all duration-300 ${isTalking ? "bg-green-500/10 border-green-500/20 text-green-600" : "bg-white/80 backdrop-blur-sm border-border text-muted-foreground"}`}>
                        {isTalking ? `Speaking (${mood})` : "Idle"}
                    </div>
                </div>
            </div>
        </main>
    )
}