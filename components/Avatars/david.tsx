"use client"

import { useRef, useEffect } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { useGLTF, useAnimations, OrbitControls, Environment } from '@react-three/drei'
import { useControls } from 'leva'
import * as THREE from 'three'

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
}

function Model({ externalIsTalking, currentMood }: ModelProps) {
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
        const lerpSpeed = 5 * delta

        let targetSmile = 0
        let targetBrowDown = 0
        let targetBrowUp = 0
        let targetSquint = 0

        switch (currentMood) {
            case 'happy':
                targetSmile = 0.6
                targetSquint = 0.3
                break
            case 'serious':
                targetBrowDown = 0.7
                targetSquint = 0.2
                targetSmile = 0
                break
            case 'surprise':
                targetBrowUp = 0.8
                targetSmile = 0.1
                break
            default:
                targetSmile = 0.05
                targetBrowDown = 0
        }

        morphRefs.current.smile = THREE.MathUtils.lerp(morphRefs.current.smile, targetSmile, lerpSpeed)
        morphRefs.current.browDown = THREE.MathUtils.lerp(morphRefs.current.browDown, targetBrowDown, lerpSpeed)
        morphRefs.current.browUp = THREE.MathUtils.lerp(morphRefs.current.browUp, targetBrowUp, lerpSpeed)
        morphRefs.current.squint = THREE.MathUtils.lerp(morphRefs.current.squint, targetSquint, lerpSpeed)

        const baseWave = Math.sin(t * 30) * 0.5 + 0.5
        const randomFlutter = Math.sin(t * 12) * 0.3 + 0.7
        const talkValue = externalIsTalking ? Math.pow(baseWave, 2) * randomFlutter * 1.2 : 0

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

        scene.traverse((child: THREE.Object3D) => {
            if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).morphTargetDictionary && (child as THREE.Mesh).morphTargetInfluences) {
                const mesh = child as THREE.Mesh
                const dict = mesh.morphTargetDictionary!
                const influences = mesh.morphTargetInfluences!

                const mL = dict['eyeBlinkLeft']; const mR = dict['eyeBlinkRight']
                if (mL !== undefined) influences[mL] = Math.min(1, autoBlinkValue + morphRefs.current.squint)
                if (mR !== undefined) influences[mR] = Math.min(1, autoBlinkValue + morphRefs.current.squint)

                const mOpen = dict['mouthOpen'] ?? dict['viseme_aa']
                const mSmile = dict['mouthSmile'] ?? dict['mouthSmileLeft']
                
                if (mOpen !== undefined) influences[mOpen] = talkValue
                if (mSmile !== undefined) influences[mSmile] = morphRefs.current.smile

                const bDownL = dict['browDownLeft']; const bDownR = dict['browDownRight']
                const bInnerUp = dict['browInnerUp']
                
                if (bDownL !== undefined) influences[bDownL] = morphRefs.current.browDown
                if (bDownR !== undefined) influences[bDownR] = morphRefs.current.browDown
                if (bInnerUp !== undefined) influences[bInnerUp] = morphRefs.current.browUp
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
}

const DavidModel = ({ isTalking, mood }: DavidModelProps) => {
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
                <Model externalIsTalking={isTalking} currentMood={mood} />
                <OrbitControls makeDefault target={[0, 2.7, 0]} enableDamping={true} minPolarAngle={Math.PI / 3} maxPolarAngle={Math.PI / 1.8} />
            </Canvas>
        </div>
    )
}

export default DavidModel