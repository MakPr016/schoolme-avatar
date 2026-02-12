"use client"

import { useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import {
    useGLTF,
    OrbitControls,
    GizmoHelper,
    GizmoViewport,
    useHelper,
    Environment
} from '@react-three/drei'
import { useControls } from 'leva'
import * as THREE from 'three'

function Model() {
    const { scene } = useGLTF("/avatars/david.glb")

    const { position, scale } = useControls("Model", {
        position: { value: [0, -2, 0], step: 0.1 },
        scale: { value: 3, min: 0.1, max: 10, step: 0.1 }
    })

    return <primitive object={scene} position={position} scale={[scale, scale, scale]} />
}

function ControlledLight() {
    const lightRef = useRef<THREE.SpotLight>(null!)

    const { color, intensity, position, angle } = useControls("Spotlight", {
        color: "#e7e88d",
        intensity: { value: 20, min: 0, max: 500 },
        position: { value: [0, 5, 5], step: 0.5 },
        angle: { value: 0.6, min: 0, max: Math.PI / 2 },
        // penumbra: { value: 0.5, min: 0, max: 1 }
    })

    useHelper(lightRef, THREE.SpotLightHelper, "yellow")

    return (
        <spotLight
            ref={lightRef}
            color={color}
            intensity={intensity}
            position={position}
            angle={angle}
            // penumbra={penumbra}
            castShadow
        />
    )
}

const DavidModel = () => {
    return (
        <div className="h-screen w-screen">
            <Canvas camera={{ position: [0, 3, 3], fov: 50 }} shadows>

                <Environment preset="city" />

                <ambientLight intensity={0.5} />
                <ControlledLight />

                <Model />

                <OrbitControls
                    makeDefault
                    target={[0, 3, 0]}
                    enableDamping={true}
                />
                <gridHelper args={[20, 20, 0xffffff, 0x444444]} />
                <axesHelper args={[5]} />

                <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
                    <GizmoViewport axisColors={['#9d4b4b', '#2f7f4f', '#3b5b9d']} labelColor="white" />
                </GizmoHelper>
            </Canvas>
        </div>
    )
}

export default DavidModel