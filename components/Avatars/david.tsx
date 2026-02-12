"use client"

import { useRef, useEffect } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { useGLTF, useAnimations, OrbitControls, Environment } from '@react-three/drei'
import { useControls } from 'leva'
import * as THREE from 'three'
import {
    type LipSyncData,
    type VisemeName,
    getCurrentViseme,
    VISEME_TARGETS,
    VISEME_INTENSITY,
    VISEME_JAW,
} from '@/lib/lipSync'

const ANIMATIONS = {
    'None': '',
    'Idle - F Variations 001': '/animations/glb/idle/F_Standing_Idle_Variations_001.glb',
    'Idle - F Variations 006': '/animations/glb/idle/F_Standing_Idle_Variations_006.glb',
    'Idle - M Variations 006': '/animations/glb/idle/M_Standing_Idle_Variations_006.glb',
    'Talking - F Variation 001': '/animations/glb/expression/F_Talking_Variations_001.glb',
    'Talking - M Variation 008': '/animations/glb/expression/M_Talking_Variations_008.glb',
}

export type AvatarMood = "neutral" | "happy" | "serious" | "surprise"

type ModelProps = {
    externalIsTalking: boolean
    currentMood: AvatarMood
    lipSyncRef: React.RefObject<LipSyncData>
}

function Model({ externalIsTalking, currentMood, lipSyncRef }: ModelProps) {
    const { scene, nodes } = useGLTF("/avatars/david.glb") as any
    const group = useRef<THREE.Group>(null)

    const { selectedAnimation, animationSpeed } = useControls('Animation', {
        selectedAnimation: {
            value: 'None',
            options: Object.keys(ANIMATIONS)
        },
        animationSpeed: {
            value: 0.5,
            min: 0.1,
            max: 2,
            step: 0.1,
            label: 'Speed'
        }
    })

    const animationPath = ANIMATIONS[selectedAnimation as keyof typeof ANIMATIONS]
    const animationGLTF = animationPath ? useGLTF(animationPath) : null
    const { actions, mixer } = useAnimations(
        animationGLTF?.animations || [],
        group
    )

    useEffect(() => {
        if (animationPath && actions) {
            const actionNames = Object.keys(actions)
            if (actionNames.length > 0) {
                const action = actions[actionNames[0]]
                if (action) {
                    action.reset().fadeIn(0.5).play()
                    action.timeScale = animationSpeed
                    return () => {
                        action.fadeOut(0.5)
                    }
                }
            }
        }
    }, [selectedAnimation, actions, animationPath, animationSpeed])

    const morphRefs = useRef({
        smile: 0,
        browDown: 0,
        browUp: 0,
        squint: 0
    })

    const blinkState = useRef({
        isBlinking: false,
        blinkStartTime: 0,
        nextBlinkTime: 2
    })

    const armPose = {
        rightArmZ: -0.1, rightArmX: 1.2, rightForeArmZ: -0.2, rightForeArmX: 0.1, rightHandZ: -0.6,
        leftArmZ: 0.2, leftArmX: 1.2, leftForeArmZ: 0.0, leftForeArmX: 0.0, leftHandZ: 0.5
    }

    useFrame((state, delta) => {
        if (mixer) mixer.update(delta)

        const t = state.clock.getElapsedTime()
        const exprLerp = Math.min(1, 5 * delta)     // expressions: smooth
        const visemeLerp = Math.min(1, 20 * delta)   // visemes: snappy

        // ── Mood → expression targets (subtle values) ────────────
        let targetSmile = 0
        let targetBrowDown = 0
        let targetBrowUp = 0
        let targetSquint = 0

        switch (currentMood) {
            case 'happy':
                targetSmile = 0.35
                targetSquint = 0.15
                break
            case 'serious':
                targetBrowDown = 0.35
                targetSquint = 0.10
                break
            case 'surprise':
                targetBrowUp = 0.45
                targetSmile = 0.05
                break
            default:
                targetSmile = 0.05
        }

        morphRefs.current.smile    = THREE.MathUtils.lerp(morphRefs.current.smile,    targetSmile,    exprLerp)
        morphRefs.current.browDown = THREE.MathUtils.lerp(morphRefs.current.browDown, targetBrowDown, exprLerp)
        morphRefs.current.browUp   = THREE.MathUtils.lerp(morphRefs.current.browUp,   targetBrowUp,   exprLerp)
        morphRefs.current.squint   = THREE.MathUtils.lerp(morphRefs.current.squint,   targetSquint,   exprLerp)

        // ── Blink ────────────────────────────────────────────────
        let autoBlinkValue = 0
        if (t > blinkState.current.nextBlinkTime) {
            blinkState.current.isBlinking = true
            blinkState.current.blinkStartTime = t
            blinkState.current.nextBlinkTime = t + 2 + Math.random() * 4
        }
        if (blinkState.current.isBlinking) {
            const blinkDuration = 0.15
            const progress = (t - blinkState.current.blinkStartTime) / blinkDuration
            if (progress >= 1) {
                blinkState.current.isBlinking = false
                autoBlinkValue = 0
            } else {
                autoBlinkValue = Math.sin(progress * Math.PI)
            }
        }

        // ── Lip-sync: determine current viseme ───────────────────
        const lsData = lipSyncRef.current
        const lipSyncActive = lsData.isActive
        let currentViseme: VisemeName = 'sil'

        if (lipSyncActive) {
            // Prefer audioElement.currentTime for frame-perfect sync
            const elapsed = lsData.audioElement && !lsData.audioElement.paused
                ? lsData.audioElement.currentTime
                : (performance.now() - lsData.startTime) / 1000
            currentViseme = getCurrentViseme(lsData.timeline, elapsed)
        }

        // Reduce smile during speech so it doesn't fight the visemes
        const smileScale = lipSyncActive ? 0.3 : 1.0

        // Subtle brow micro-movement while talking
        const microBrow = lipSyncActive
            ? Math.max(0, Math.sin(t * 3.5) * 0.06 + Math.sin(t * 7.1) * 0.03)
            : 0

        // ── Scene traversal: apply all morph targets ─────────────
        scene.traverse((child: THREE.Object3D) => {
            if (
                (child as THREE.Mesh).isMesh &&
                (child as THREE.Mesh).morphTargetDictionary &&
                (child as THREE.Mesh).morphTargetInfluences
            ) {
                const mesh = child as THREE.Mesh
                const dict = mesh.morphTargetDictionary!
                const infl = mesh.morphTargetInfluences!

                // ▸ Eyes – blink + squint
                const bL = dict['eyeBlinkLeft'],  bR = dict['eyeBlinkRight']
                if (bL !== undefined) infl[bL] = THREE.MathUtils.lerp(infl[bL], Math.min(1, autoBlinkValue + morphRefs.current.squint), visemeLerp)
                if (bR !== undefined) infl[bR] = THREE.MathUtils.lerp(infl[bR], Math.min(1, autoBlinkValue + morphRefs.current.squint), visemeLerp)

                // ▸ Brows
                const bdL = dict['browDownLeft'],  bdR = dict['browDownRight']
                const bIU = dict['browInnerUp']
                if (bdL !== undefined) infl[bdL] = THREE.MathUtils.lerp(infl[bdL], morphRefs.current.browDown, exprLerp)
                if (bdR !== undefined) infl[bdR] = THREE.MathUtils.lerp(infl[bdR], morphRefs.current.browDown, exprLerp)
                if (bIU !== undefined) infl[bIU] = THREE.MathUtils.lerp(infl[bIU], morphRefs.current.browUp + microBrow, exprLerp)

                // ▸ Smile (attenuated while speaking)
                const mSmile = dict['mouthSmile'] ?? dict['mouthSmileLeft']
                if (mSmile !== undefined) {
                    infl[mSmile] = THREE.MathUtils.lerp(infl[mSmile], morphRefs.current.smile * smileScale, exprLerp)
                }

                // ▸ Viseme morph targets (lip sync)
                for (const target of VISEME_TARGETS) {
                    const idx = dict[target]
                    if (idx !== undefined) {
                        const vName = target.replace('viseme_', '') as VisemeName
                        const targetVal = vName === currentViseme ? VISEME_INTENSITY[currentViseme] : 0
                        infl[idx] = THREE.MathUtils.lerp(infl[idx], targetVal, visemeLerp)
                    }
                }

                // ▸ Supplementary jaw open
                const jaw = dict['jawOpen']
                if (jaw !== undefined) {
                    infl[jaw] = THREE.MathUtils.lerp(infl[jaw], VISEME_JAW[currentViseme], visemeLerp)
                }

                // ▸ Fallback: if model lacks viseme_* targets, drive mouthOpen
                if (dict['viseme_aa'] === undefined) {
                    const mOpen = dict['mouthOpen']
                    if (mOpen !== undefined) {
                        infl[mOpen] = THREE.MathUtils.lerp(infl[mOpen], VISEME_JAW[currentViseme] * 1.8, visemeLerp)
                    }
                }
            }
        })

        if (nodes.RightArm) {
            nodes.RightArm.rotation.z = armPose.rightArmZ
            nodes.RightArm.rotation.x = armPose.rightArmX
        }
        if (nodes.RightForeArm) {
            nodes.RightForeArm.rotation.z = armPose.rightForeArmZ
            nodes.RightForeArm.rotation.x = armPose.rightForeArmX
        }
        if (nodes.RightHand) nodes.RightHand.rotation.z = armPose.rightHandZ

        if (nodes.LeftArm) {
            nodes.LeftArm.rotation.z = armPose.leftArmZ
            nodes.LeftArm.rotation.x = armPose.leftArmX
        }
        if (nodes.LeftForeArm) {
            nodes.LeftForeArm.rotation.z = armPose.leftForeArmZ
            nodes.LeftForeArm.rotation.x = armPose.leftForeArmX
        }
        if (nodes.LeftHand) nodes.LeftHand.rotation.z = armPose.leftHandZ
    })

    return (
        <group ref={group}>
            <primitive object={scene} position={[0, -2, 0]} scale={[3, 3, 3]} />
        </group>
    )
}

type DavidModelProps = {
    isTalking: boolean
    mood: AvatarMood
    lipSyncRef: React.RefObject<LipSyncData>
}

const DavidModel = ({ isTalking, mood, lipSyncRef }: DavidModelProps) => {
    return (
        <div className="h-full w-full bg-background rounded-xl overflow-hidden border">
            <Canvas
                camera={{ position: [0, 3.5, 3], fov: 40 }}
                shadows
                onCreated={({ gl }) => { gl.setClearColor('#f8fafc') }}
            >
                <Environment preset="city" />
                <ambientLight intensity={0.7} />
                <spotLight color="#fff" intensity={8} position={[2, 5, 2]} angle={0.7} penumbra={0.5} castShadow />
                <Model externalIsTalking={isTalking} currentMood={mood} lipSyncRef={lipSyncRef} />
                <OrbitControls makeDefault target={[0, 2.7, 0]} enableDamping={true} minPolarAngle={Math.PI / 3} maxPolarAngle={Math.PI / 1.8} />
            </Canvas>
        </div>
    )
}

export default DavidModel