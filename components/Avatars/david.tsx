"use client"

import { useRef, useEffect } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { useGLTF, OrbitControls, Environment, GizmoHelper, GizmoViewport } from '@react-three/drei'
import { useControls } from 'leva'
import * as THREE from 'three'

type ModelProps = {
    externalIsTalking: boolean
}

function Model({ externalIsTalking }: ModelProps) {
    const { scene, nodes } = useGLTF("/avatars/david.glb") as any
    const group = useRef<THREE.Group>(null)

    const blinkState = useRef({
        isBlinking: false,
        blinkStartTime: 0,
        nextBlinkTime: 2
    })

    const {
        mouthOpen,
        blinkLeft,
        blinkRight,
        headSway
    } = useControls("Animation Settings", {
        mouthOpen: { value: 0, min: 0, max: 1, step: 0.01 },
        blinkLeft: { value: 0, min: 0, max: 1, step: 0.01 },
        blinkRight: { value: 0, min: 0, max: 1, step: 0.01 },
        headSway: { value: true }
    })

    const {
        rightArmZ, rightArmX,
        rightForeArmZ, rightForeArmX,
        rightHandZ,
        leftArmZ, leftArmX,
        leftForeArmZ, leftForeArmX,
        leftHandZ
    } = useControls("Arm Positioning", {
        rightArmZ: { value: 0.0, min: -3, max: 3, step: 0.1 },
        rightArmX: { value: 1.2, min: -3, max: 3, step: 0.1 },
        rightForeArmZ: { value: 0.0, min: -3, max: 3, step: 0.1 },
        rightForeArmX: { value: 0.0, min: -3, max: 3, step: 0.1 },
        rightHandZ: { value: -0.3, min: -3, max: 3, step: 0.1 },

        leftArmZ: { value: 0.0, min: -3, max: 3, step: 0.1 },
        leftArmX: { value: 1.2, min: -3, max: 3, step: 0.1 },
        leftForeArmZ: { value: 0.3, min: -3, max: 3, step: 0.1 },
        leftForeArmX: { value: 0.0, min: -3, max: 3, step: 0.1 },
        leftHandZ: { value: 0.3, min: -3, max: 3, step: 0.1 }
    })

    useFrame((state) => {
        const t = state.clock.getElapsedTime()

        const talkValue = Math.max(0, Math.sin(t * 15) * 0.5 + Math.sin(t * 5) * 0.5) * 0.8

        let autoBlinkValue = 0
        if (t > blinkState.current.nextBlinkTime) {
            blinkState.current.isBlinking = true
            blinkState.current.blinkStartTime = t
            blinkState.current.nextBlinkTime = t + 3 + Math.random() * 5
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

                const mL = dict['eyeBlinkLeft']
                const mR = dict['eyeBlinkRight']
                if (mL !== undefined) influences[mL] = Math.min(1, blinkLeft + autoBlinkValue)
                if (mR !== undefined) influences[mR] = Math.min(1, blinkRight + autoBlinkValue)

                const mO = dict['mouthOpen'] ?? dict['viseme_aa']
                if (mO !== undefined) {
                    influences[mO] = externalIsTalking ? talkValue : mouthOpen
                }
            }
        })

        if (nodes.RightArm) {
            nodes.RightArm.rotation.z = rightArmZ
            nodes.RightArm.rotation.x = rightArmX
        }
        if (nodes.RightForeArm) {
            nodes.RightForeArm.rotation.z = rightForeArmZ
            nodes.RightForeArm.rotation.x = rightForeArmX
        }
        if (nodes.RightHand) nodes.RightHand.rotation.z = rightHandZ

        if (nodes.LeftArm) {
            nodes.LeftArm.rotation.z = leftArmZ
            nodes.LeftArm.rotation.x = leftArmX
        }
        if (nodes.LeftForeArm) {
            nodes.LeftForeArm.rotation.z = leftForeArmZ
            nodes.LeftForeArm.rotation.x = leftForeArmX
        }
        if (nodes.LeftHand) nodes.LeftHand.rotation.z = leftHandZ

        if (headSway && group.current) {
            group.current.rotation.y = Math.sin(t * 0.5) * 0.05
            group.current.position.y = -2 + Math.sin(t * 2) * 0.01
        }
    })

    return (
        <group ref={group}>
            <primitive object={scene} position={[0, -2, 0]} scale={[3, 3, 3]} />
        </group>
    )
}

type DavidModelProps = {
    isTalking: boolean
}

const DavidModel = ({ isTalking }: DavidModelProps) => {
    return (
        <div className="h-full w-full bg-background rounded-xl overflow-hidden border">
            <Canvas
                camera={{ position: [0, 1.5, 4], fov: 40 }}
                shadows
                onCreated={({ gl }) => { gl.setClearColor('#fff') }}
            >
                <Environment preset="city" />
                <ambientLight intensity={0.6} />

                <spotLight
                    color="#e7e88d"
                    intensity={10}
                    position={[0, 5, 2]}
                    angle={0.7}
                    penumbra={0.5}
                    castShadow
                />

                <Model externalIsTalking={isTalking} />

                <OrbitControls makeDefault target={[0, 1, 0]} enableDamping={true} />

                <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
                    <GizmoViewport axisColors={['#9d4b4b', '#2f7f4f', '#3b5b9d']} labelColor="white" />
                </GizmoHelper>
            </Canvas>
        </div>
    )
}

export default DavidModel