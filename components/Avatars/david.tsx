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
    const { scene, nodes } = useGLTF("/avatars/david.glb")
    const group = useRef<THREE.Group>(null)

    const { 
        mouthOpen, 
        blinkLeft, 
        blinkRight, 
        headSway,
        isExplaining
    } = useControls("Animation", {
        mouthOpen: { value: 0, min: 0, max: 1, step: 0.01 },
        blinkLeft: { value: 0, min: 0, max: 1, step: 0.01 },
        blinkRight: { value: 0, min: 0, max: 1, step: 0.01 },
        headSway: { value: true },
        isExplaining: { value: true }
    })

    const {
        rightArmZ, rightArmX,
        rightForeArmZ, rightForeArmY,
        leftArmZ, leftArmX,
        leftForeArmZ, leftForeArmY
    } = useControls("Arm Positioning", {
        rightArmZ: { value: 0.35, min: -3, max: 3, step: 0.1 },
        rightArmX: { value: 0.70, min: -3, max: 3, step: 0.1 },
        rightForeArmZ: { value: -1.75, min: -3, max: 3, step: 0.1 },
        rightForeArmY: { value: 0.52, min: -3, max: 3, step: 0.1 },
        leftArmZ: { value: -0.35, min: -3, max: 3, step: 0.1 },
        leftArmX: { value: 0.70, min: -3, max: 3, step: 0.1 },
        leftForeArmZ: { value: 1.75, min: -3, max: 3, step: 0.1 },
        leftForeArmY: { value: -0.52, min: -3, max: 3, step: 0.1 }
    })

    useFrame((state) => {
        const t = state.clock.getElapsedTime()

        scene.traverse((child) => {
            if (child instanceof THREE.Mesh && child.morphTargetDictionary && child.morphTargetInfluences) {
                if (child.name === "Wolf3D_Head" || child.name === "EyeLeft" || child.name === "EyeRight") {
                    const mL = child.morphTargetDictionary['eyeBlinkLeft']
                    const mR = child.morphTargetDictionary['eyeBlinkRight']
                    const mO = child.morphTargetDictionary['mouthOpen'] ?? child.morphTargetDictionary['viseme_aa']

                    if (mL !== undefined) child.morphTargetInfluences[mL] = blinkLeft
                    if (mR !== undefined) child.morphTargetInfluences[mR] = blinkRight
                    if (mO !== undefined && child.name === "Wolf3D_Head") child.morphTargetInfluences[mO] = mouthOpen
                }

                if (child.name === "Wolf3D_Teeth" || child.name === "Wolf3D_Beard") {
                    const mO = child.morphTargetDictionary['mouthOpen'] ?? child.morphTargetDictionary['viseme_aa']
                    if (mO !== undefined) child.morphTargetInfluences[mO] = mouthOpen
                }
            }
        })

        if (isExplaining) {
            if (nodes.RightArm) {
                nodes.RightArm.rotation.z = rightArmZ + Math.sin(t * 1) * 0.05
                nodes.RightArm.rotation.x = rightArmX + Math.cos(t * 1) * 0.05
            }
            if (nodes.RightForeArm) {
                nodes.RightForeArm.rotation.z = rightForeArmZ + Math.sin(t * 2) * 0.2
                nodes.RightForeArm.rotation.y = rightForeArmY
            }

            if (nodes.LeftArm) {
                nodes.LeftArm.rotation.z = leftArmZ - Math.sin(t * 1) * 0.05
                nodes.LeftArm.rotation.x = leftArmX + Math.cos(t * 1) * 0.05
            }
            if (nodes.LeftForeArm) {
                nodes.LeftForeArm.rotation.z = leftForeArmZ - Math.sin(t * 2) * 0.2
                nodes.LeftForeArm.rotation.y = leftForeArmY
            }
        }

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
                    intensity={10}
                    position={[0, 5, 2]}
                    angle={0.7}
                    penumbra={0.5}
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