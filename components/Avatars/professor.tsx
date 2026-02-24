"use client"

import { useRef, useEffect, useMemo } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useGLTF, Environment } from '@react-three/drei'
import { useGraph } from '@react-three/fiber'
import { SkeletonUtils } from 'three-stdlib'
import { useControls } from 'leva'
import * as THREE from 'three'
import {
    type LipSyncData,
    type VisemeName,
    getCurrentViseme,
    getAmplitude,
    SILENCE_THRESHOLD,
    VISEME_TARGETS,
    VISEME_INTENSITY,
    VISEME_JAW,
} from '@/lib/lipSync'

const VISEME_KEYS = VISEME_TARGETS

export type AvatarMood = "neutral" | "happy" | "serious" | "surprise"

type ModelProps = {
    externalIsTalking: boolean
    currentMood: AvatarMood
    lipSyncRef: React.RefObject<LipSyncData>
}

type ProfessorModelProps = {
    isTalking: boolean
    mood: AvatarMood
    lipSyncRef: React.RefObject<LipSyncData>
}

function Model({ externalIsTalking, currentMood, lipSyncRef }: ModelProps) {

    const { mouthIntensity, jawIntensity, jawOpenMax, lowerLipMax } = useControls('Mouth & Jaw', {
        mouthIntensity: { label: 'Mouth Intensity', value: 1.0,  min: 0.0, max: 2.0, step: 0.01 },
        jawIntensity:   { label: 'Jaw Viseme Scale', value: 1.0,  min: 0.0, max: 2.0, step: 0.01 },
        jawOpenMax:     { label: 'Jaw Open Max',     value: 0.45, min: 0.0, max: 1.0, step: 0.01 },
        lowerLipMax:    { label: 'Lower Lip Max',    value: 0.40, min: 0.0, max: 1.0, step: 0.01 },
    })

    const { previewViseme } = useControls('Viseme Preview', {
        previewViseme: {
            label: 'Viseme',
            value: '(none)',
            options: ['(none)', 'sil', 'PP', 'FF', 'TH', 'DD', 'kk', 'CH', 'SS', 'nn', 'RR', 'aa', 'E', 'I', 'O', 'U'],
        },
    })

    const armPose = useControls('Arm Pose', {
        rightArmZ:     { value: -0.1, min: -3.14, max: 3.14, step: 0.01 },
        rightArmX:     { value:  1.2, min: -3.14, max: 3.14, step: 0.01 },
        rightForeArmZ: { value: -0.2, min: -3.14, max: 3.14, step: 0.01 },
        rightForeArmX: { value:  0.1, min: -3.14, max: 3.14, step: 0.01 },
        rightHandZ:    { value: -0.6, min: -3.14, max: 3.14, step: 0.01 },
        leftArmZ:      { value:  0.2, min: -3.14, max: 3.14, step: 0.01 },
        leftArmX:      { value:  1.2, min: -3.14, max: 3.14, step: 0.01 },
        leftForeArmZ:  { value:  0.0, min: -3.14, max: 3.14, step: 0.01 },
        leftForeArmX:  { value:  0.0, min: -3.14, max: 3.14, step: 0.01 },
        leftHandZ:     { value:  0.5, min: -3.14, max: 3.14, step: 0.01 },
    })

    const { scene } = useGLTF('/avatars/698f2ae7e61aa2e2a22d0ed2.glb')
    const clone = useMemo(() => SkeletonUtils.clone(scene), [scene])
    const { nodes, materials } = useGraph(clone) as any

    const morphRefs  = useRef({ smile: 0, browDown: 0, browUp: 0, squint: 0 })
    const blinkState = useRef({ isBlinking: false, blinkStartTime: 0, nextBlinkTime: 2 })
    const visemeBlend = useRef<Record<string, number>>(
        Object.fromEntries(VISEME_KEYS.map(k => [k, 0]))
    )

    useFrame((state, delta) => {
        const head  = nodes.Wolf3D_Head  as THREE.SkinnedMesh | undefined
        const teeth = nodes.Wolf3D_Teeth as THREE.SkinnedMesh | undefined
        if (!head || !teeth) return

        const t        = state.clock.getElapsedTime()
        const exprLerp = Math.min(1, 5  * delta)
        const visLerp  = Math.min(1, 20 * delta)

        let targetSmile = 0, targetBrowDown = 0, targetBrowUp = 0, targetSquint = 0

        switch (currentMood) {
            case 'happy':    targetSmile = 0.35;   targetSquint   = 0.15; break
            case 'serious':  targetBrowDown = 0.35; targetSquint  = 0.10; break
            case 'surprise': targetBrowUp = 0.45;  targetSmile    = 0.05; break
            default:         targetSmile = 0.05
        }

        morphRefs.current.smile    = THREE.MathUtils.lerp(morphRefs.current.smile,    targetSmile,    exprLerp)
        morphRefs.current.browDown = THREE.MathUtils.lerp(morphRefs.current.browDown, targetBrowDown, exprLerp)
        morphRefs.current.browUp   = THREE.MathUtils.lerp(morphRefs.current.browUp,   targetBrowUp,   exprLerp)
        morphRefs.current.squint   = THREE.MathUtils.lerp(morphRefs.current.squint,   targetSquint,   exprLerp)

        let autoBlinkValue = 0
        if (t > blinkState.current.nextBlinkTime) {
            blinkState.current.isBlinking     = true
            blinkState.current.blinkStartTime = t
            blinkState.current.nextBlinkTime  = t + 2 + Math.random() * 4
        }
        if (blinkState.current.isBlinking) {
            const progress = (t - blinkState.current.blinkStartTime) / 0.15
            if (progress >= 1) { blinkState.current.isBlinking = false }
            else               { autoBlinkValue = Math.sin(progress * Math.PI) }
        }

        const lsData        = lipSyncRef.current
        const lipSyncActive = lsData.isActive
        let   currentViseme: VisemeName = 'sil'

        // Viseme preview override — when a viseme is selected in the Leva panel,
        // skip the live lip-sync pipeline and force that viseme on.
        if (previewViseme !== '(none)') {
            currentViseme = previewViseme as VisemeName
        } else if (lipSyncActive) {
            const elapsed = lsData.audioElement && !lsData.audioElement.paused
                ? lsData.audioElement.currentTime
                : (performance.now() - lsData.startTime) / 1000
            const timelineViseme = getCurrentViseme(lsData.timeline, elapsed)
            if (lsData.analyser && lsData.analyserBuffer && timelineViseme !== 'sil') {
                const amplitude = getAmplitude(lsData.analyser, lsData.analyserBuffer)
                currentViseme = amplitude >= SILENCE_THRESHOLD ? timelineViseme : 'sil'
            } else {
                currentViseme = timelineViseme
            }
        }

        const isPreviewing = previewViseme !== '(none)'
        const microBrow  = (lipSyncActive || isPreviewing) ? Math.max(0, Math.sin(t * 3.5) * 0.06 + Math.sin(t * 7.1) * 0.03) : 0
        const smileScale = (lipSyncActive || isPreviewing) ? 0.3 : 1.0
        const rawJaw     = VISEME_JAW[currentViseme]
        const jawValue   = Math.min(jawOpenMax,  rawJaw * jawIntensity)
        const lowerLipVal = Math.min(lowerLipMax, rawJaw * jawIntensity)

        const hDict = head.morphTargetDictionary
        const hInfl = head.morphTargetInfluences
        const tDict = teeth.morphTargetDictionary
        const tInfl = teeth.morphTargetInfluences
        if (!hDict || !hInfl || !tDict || !tInfl) return

        const bL  = hDict['eyeBlinkLeft'],   bR  = hDict['eyeBlinkRight']
        const bdL = hDict['browDownLeft'],    bdR = hDict['browDownRight']
        const bIU = hDict['browInnerUp']
        const mSm = hDict['mouthSmile'] ?? hDict['mouthSmileLeft']

        if (bL  !== undefined) hInfl[bL]  = THREE.MathUtils.lerp(hInfl[bL],  Math.min(1, autoBlinkValue + morphRefs.current.squint), visLerp)
        if (bR  !== undefined) hInfl[bR]  = THREE.MathUtils.lerp(hInfl[bR],  Math.min(1, autoBlinkValue + morphRefs.current.squint), visLerp)
        if (bdL !== undefined) hInfl[bdL] = THREE.MathUtils.lerp(hInfl[bdL], morphRefs.current.browDown,           exprLerp)
        if (bdR !== undefined) hInfl[bdR] = THREE.MathUtils.lerp(hInfl[bdR], morphRefs.current.browDown,           exprLerp)
        if (bIU !== undefined) hInfl[bIU] = THREE.MathUtils.lerp(hInfl[bIU], morphRefs.current.browUp + microBrow, exprLerp)
        if (mSm !== undefined) hInfl[mSm] = THREE.MathUtils.lerp(hInfl[mSm], morphRefs.current.smile * smileScale, exprLerp)

        for (const target of VISEME_KEYS) {
            const vName  = target.replace('viseme_', '') as VisemeName
            const tgtVal = vName === currentViseme
                ? Math.min(1, VISEME_INTENSITY[currentViseme] * mouthIntensity)
                : 0
            visemeBlend.current[target] = THREE.MathUtils.lerp(visemeBlend.current[target], tgtVal, visLerp)
            const hi = hDict[target], ti = tDict[target]
            if (hi !== undefined) hInfl[hi] = visemeBlend.current[target]
            if (ti !== undefined) tInfl[ti] = visemeBlend.current[target]
        }

        const jawIdx = hDict['jawOpen'], llIdx = hDict['mouthLowerDownLeft'], lrIdx = hDict['mouthLowerDownRight']
        if (jawIdx !== undefined) hInfl[jawIdx] = THREE.MathUtils.lerp(hInfl[jawIdx], jawValue,    visLerp)
        if (llIdx  !== undefined) hInfl[llIdx]  = THREE.MathUtils.lerp(hInfl[llIdx],  lowerLipVal, visLerp)
        if (lrIdx  !== undefined) hInfl[lrIdx]  = THREE.MathUtils.lerp(hInfl[lrIdx],  lowerLipVal, visLerp)

        if (nodes.RightArm)     { nodes.RightArm.rotation.z     = armPose.rightArmZ;     nodes.RightArm.rotation.x     = armPose.rightArmX }
        if (nodes.RightForeArm) { nodes.RightForeArm.rotation.z = armPose.rightForeArmZ; nodes.RightForeArm.rotation.x = armPose.rightForeArmX }
        if (nodes.RightHand)      nodes.RightHand.rotation.z     = armPose.rightHandZ
        if (nodes.LeftArm)      { nodes.LeftArm.rotation.z      = armPose.leftArmZ;      nodes.LeftArm.rotation.x      = armPose.leftArmX }
        if (nodes.LeftForeArm)  { nodes.LeftForeArm.rotation.z  = armPose.leftForeArmZ;  nodes.LeftForeArm.rotation.x  = armPose.leftForeArmX }
        if (nodes.LeftHand)       nodes.LeftHand.rotation.z      = armPose.leftHandZ
    })

    return (
        <group dispose={null}>
            <primitive object={nodes.Hips} />
            <skinnedMesh geometry={nodes.Wolf3D_Hair.geometry}            material={materials.Wolf3D_Hair}           skeleton={nodes.Wolf3D_Hair.skeleton} />
            <skinnedMesh geometry={nodes.Wolf3D_Body.geometry}            material={materials.Wolf3D_Body}           skeleton={nodes.Wolf3D_Body.skeleton} />
            <skinnedMesh geometry={nodes.Wolf3D_Outfit_Bottom.geometry}   material={materials.Wolf3D_Outfit_Bottom}  skeleton={nodes.Wolf3D_Outfit_Bottom.skeleton} />
            <skinnedMesh geometry={nodes.Wolf3D_Outfit_Footwear.geometry} material={materials.Wolf3D_Outfit_Footwear} skeleton={nodes.Wolf3D_Outfit_Footwear.skeleton} />
            <skinnedMesh geometry={nodes.Wolf3D_Outfit_Top.geometry}      material={materials.Wolf3D_Outfit_Top}     skeleton={nodes.Wolf3D_Outfit_Top.skeleton} />
            <skinnedMesh name="EyeLeft"      geometry={nodes.EyeLeft.geometry}      material={materials.Wolf3D_Eye}   skeleton={nodes.EyeLeft.skeleton}      morphTargetDictionary={nodes.EyeLeft.morphTargetDictionary}      morphTargetInfluences={nodes.EyeLeft.morphTargetInfluences} />
            <skinnedMesh name="EyeRight"     geometry={nodes.EyeRight.geometry}     material={materials.Wolf3D_Eye}   skeleton={nodes.EyeRight.skeleton}     morphTargetDictionary={nodes.EyeRight.morphTargetDictionary}     morphTargetInfluences={nodes.EyeRight.morphTargetInfluences} />
            <skinnedMesh name="Wolf3D_Head"  geometry={nodes.Wolf3D_Head.geometry}  material={materials.Wolf3D_Skin}  skeleton={nodes.Wolf3D_Head.skeleton}  morphTargetDictionary={nodes.Wolf3D_Head.morphTargetDictionary}  morphTargetInfluences={nodes.Wolf3D_Head.morphTargetInfluences} />
            <skinnedMesh name="Wolf3D_Teeth" geometry={nodes.Wolf3D_Teeth.geometry} material={materials.Wolf3D_Teeth} skeleton={nodes.Wolf3D_Teeth.skeleton} morphTargetDictionary={nodes.Wolf3D_Teeth.morphTargetDictionary} morphTargetInfluences={nodes.Wolf3D_Teeth.morphTargetInfluences} />
        </group>
    )
}

function CameraController() {
    const { camera } = useThree()
    useEffect(() => {
        camera.position.set(0, 1.6, 1.2)
        camera.lookAt(0, 1.6, 0)
    }, [camera])
    return null
}

const ProfessorModel = ({ isTalking, mood, lipSyncRef }: ProfessorModelProps) => {
    return (
        <div className="h-full w-full bg-background rounded-xl overflow-hidden border">
            <Canvas
                camera={{ position: [0, 1.6, 1.2], fov: 28 }}
                shadows
                onCreated={({ gl }) => { gl.setClearColor('#f8fafc') }}
            >
                <CameraController />
                <Environment preset="city" />
                <ambientLight intensity={0.7} />
                <spotLight color="#fff" intensity={8} position={[2, 5, 2]} angle={0.7} penumbra={0.5} castShadow />
                <Model externalIsTalking={isTalking} currentMood={mood} lipSyncRef={lipSyncRef} />
            </Canvas>
        </div>
    )
}

export default ProfessorModel

useGLTF.preload('/avatars/698f2ae7e61aa2e2a22d0ed2.glb')