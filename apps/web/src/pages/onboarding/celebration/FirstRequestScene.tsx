import { Line } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AdditiveBlending,
  ExtrudeGeometry,
  Vector3,
  type Group,
  type MeshBasicMaterial,
} from 'three';
import { bubbleShape } from '../../../components/three/bubbles';
import { useTokenColors } from '../../../lib/useTokenColors';

const DURATION = 1.6; // seconds; the merge plays once, then rendering stops

const ease = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

function Merge({ colors }: { colors: Record<'--color-exact' | '--color-twin', string> }) {
  const a = useRef<Group>(null);
  const b = useRef<Group>(null);
  const glow = useRef<MeshBasicMaterial>(null);
  const solid = useMemo(
    () =>
      new ExtrudeGeometry(bubbleShape('left'), {
        depth: 0.18,
        bevelEnabled: true,
        bevelSize: 0.04,
        bevelThickness: 0.04,
        bevelSegments: 4,
        curveSegments: 16,
      }),
    [],
  );
  const outline = useMemo(
    () =>
      bubbleShape('right')
        .getPoints(24)
        .map((v) => new Vector3(v.x, v.y, 0)),
    [],
  );

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const m = ease(t / 0.9);
    if (a.current) {
      a.current.position.set(-1.9 + m * 1.35, 0.3, 0);
      a.current.rotation.y = (1 - m) * -0.5;
    }
    if (b.current) {
      b.current.position.set(1.9 - m * 1.35, -0.3, 0.25);
      b.current.rotation.y = (1 - m) * 0.5;
    }
    // The overlap lights up as they meet, flares once, then settles.
    if (glow.current) {
      const flare = Math.max(0, 1 - Math.abs(t - 1.05) / 0.35);
      glow.current.opacity = ease((t - 0.7) / 0.3) * 0.35 + flare * 0.3;
    }
  });

  return (
    <group>
      <group ref={a}>
        <mesh geometry={solid} position={[0, 0, -0.18]}>
          <meshStandardMaterial color={colors['--color-exact']} roughness={0.45} />
        </mesh>
      </group>
      <group ref={b}>
        <Line points={outline} color={colors['--color-twin']} lineWidth={2.5} />
      </group>
      <mesh position={[0, 0, 0.12]}>
        <circleGeometry args={[0.7, 48]} />
        <meshBasicMaterial
          ref={glow}
          color={colors['--color-twin']}
          transparent
          opacity={0}
          blending={AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

/** The first request has arrived: the twin bubbles merge once, and the overlap glows. */
export default function FirstRequestScene() {
  const colors = useTokenColors(['--color-exact', '--color-twin'] as const);
  const [done, setDone] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setDone(true), DURATION * 1000);
    return () => clearTimeout(timer);
  }, []);
  return (
    <Canvas
      frameloop={done ? 'demand' : 'always'}
      dpr={[1, 2]}
      camera={{ position: [0, 0.2, 6], fov: 38 }}
      gl={{ antialias: true, alpha: true }}
      aria-hidden="true"
    >
      <ambientLight intensity={1.4} />
      <directionalLight position={[3, 4, 5]} intensity={1.6} />
      <Merge colors={colors} />
    </Canvas>
  );
}
