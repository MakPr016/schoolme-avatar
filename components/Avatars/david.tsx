"use client"

import { useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import {
    useGLTF,
    OrbitControls,
    GizmoHelper,
    GizmoViewport,
    Environment
} from '@react-three/drei'
import { useControls } from 'leva'
import * as THREE from 'three'

function Model() {
    const { scene } = useGLTF("/avatars/david.glb")
    const group = useRef<THREE.Group>(null!)

    const { mouthOpen, eyeBlink, headSway } = useControls("Animation", {
        mouthOpen: { value: 0, min: 0, max: 1, step: 0.01 },
        eyeBlink: { value: 0, min: 0, max: 1, step: 0.01 },
        headSway: { value: true }
    })

    useFrame((state) => {
        const t = state.clock.getElapsedTime()

        scene.traverse((child) => {
            if (child instanceof THREE.Mesh && child.morphTargetDictionary && child.morphTargetInfluences) {

                // 1. Target Eyes (Specific meshes EyeLeft/EyeRight)
                if (child.name.toLowerCase().includes("eye")) {
                    const blinkIndex =
                        child.morphTargetDictionary['eyeBlinkLeft'] ??
                        child.morphTargetDictionary['eyeBlinkRight'] ??
                        child.morphTargetDictionary['blink'] ??
                        child.morphTargetDictionary['eyeBlink'];

                    if (blinkIndex !== undefined) {
                        child.morphTargetInfluences[blinkIndex] = eyeBlink;
                    }
                }

                // 2. Target Head (Ready Player Me often duplicates blink here too)
                if (child.name === "Wolf3D_Head") {
                    const mouthIndex = child.morphTargetDictionary['mouthOpen'] ?? child.morphTargetDictionary['viseme_aa'];
                    const blinkL = child.morphTargetDictionary['eyeBlinkLeft'];
                    const blinkR = child.morphTargetDictionary['eyeBlinkRight'];

                    if (mouthIndex !== undefined) child.morphTargetInfluences[mouthIndex] = mouthOpen;
                    if (blinkL !== undefined) child.morphTargetInfluences[blinkL] = eyeBlink;
                    if (blinkR !== undefined) child.morphTargetInfluences[blinkR] = eyeBlink;
                }

                // 3. Sync Teeth and Beard with Mouth
                if (child.name === "Wolf3D_Teeth" || child.name === "Wolf3D_Beard") {
                    const mouthIndex = child.morphTargetDictionary['mouthOpen'] ?? child.morphTargetDictionary['viseme_aa'];
                    if (mouthIndex !== undefined) child.morphTargetInfluences[mouthIndex] = mouthOpen;
                }
            }
        })

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

const DavidModel = () => {
    return (
        <div className="h-screen w-screen bg-slate-100">
            <Canvas
                camera={{ position: [0, 1.5, 4], fov: 40 }}
                shadows
                onCreated={({ gl }) => {
                    gl.setClearColor('#f1f5f9')
                }}
            >
                <Environment preset="city" />
                <ambientLight intensity={0.8} />

                <spotLight
                    color="#e7e88d"
                    intensity={20}
                    position={[0, 5, 5]}
                    angle={0.6}
                    castShadow
                />

                <Model />

                <OrbitControls
                    makeDefault
                    target={[0, 1, 0]}
                    enableDamping={true}
                />

                <gridHelper args={[20, 20, 0xcccccc, 0xdddddd]} />
                <axesHelper args={[5]} />

                <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
                    <GizmoViewport axisColors={['#9d4b4b', '#2f7f4f', '#3b5b9d']} labelColor="black" />
                </GizmoHelper>
            </Canvas>
        </div>
    )
}

export default DavidModel