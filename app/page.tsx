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
        <main className="h-screen w-screen bg-background text-foreground p-4 md:p-6 overflow-hidden flex flex-col">
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6 h-full w-full max-w-400 mx-auto">
                <div className="h-full flex flex-col min-h-125">
                    <ChatInterface 
                        onTalkingStateChange={setIsTalking} 
                        onMoodChange={setMood}
                        lipSyncRef={lipSyncRef}
                    />
                </div>

                <div className="h-full flex flex-col min-h-125 relative">
                    <DavidModel isTalking={isTalking} mood={mood} lipSyncRef={lipSyncRef} />
                    
                    <div className={`absolute top-4 right-4 px-3 py-1.5 rounded-full text-xs font-medium border transition-all duration-300 ${isTalking ? "bg-green-500/10 border-green-500/20 text-green-600" : "bg-white/80 backdrop-blur-sm border-border text-muted-foreground"}`}>
                        {isTalking ? `Speaking (${mood})` : "Idle"}
                    </div>
                </div>
            </div>
        </main>
    )
}