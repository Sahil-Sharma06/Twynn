import { Html, Line } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AdditiveBlending,
  ExtrudeGeometry,
  Shape,
  ShapeGeometry,
  Vector3,
  type Group,
  type MeshBasicMaterial,
  type MeshStandardMaterial,
} from 'three';
import { useTokenColors } from '../../../lib/useTokenColors';
import styles from './Hero.module.css';

const PERIOD = 7; // seconds per loop
const W = 2.3;
const H = 1.05;
const R = 0.32;

/** A speech bubble outline: a rounded rectangle with a tail at the bottom left or right. */
function bubbleShape(tail: 'left' | 'right'): Shape {
  const s = new Shape();
  const x = -W / 2;
  const y = -H / 2;
  s.moveTo(x + R, y);
  if (tail === 'left') {
    s.lineTo(x + 0.25, y - 0.32);
    s.lineTo(x + 0.62, y);
  }
  if (tail === 'right') {
    s.lineTo(x + W - 0.62, y);
    s.lineTo(x + W - 0.25, y - 0.32);
    s.lineTo(x + W - R, y);
  } else s.lineTo(x + W - R, y);
  s.quadraticCurveTo(x + W, y, x + W, y + R);
  s.lineTo(x + W, y + H - R);
  s.quadraticCurveTo(x + W, y + H, x + W - R, y + H);
  s.lineTo(x + R, y + H);
  s.quadraticCurveTo(x, y + H, x, y + H - R);
  s.lineTo(x, y + R);
  s.quadraticCurveTo(x, y, x + R, y);
  return s;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** 0 → 1 across [a, b], eased. */
const phase = (p: number, a: number, b: number) => {
  const t = clamp01((p - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function Twins({
  colors,
}: {
  colors: Record<'--color-exact' | '--color-twin' | '--color-surface', string>;
}) {
  const a = useRef<Group>(null);
  const b = useRef<Group>(null);
  const root = useRef<Group>(null);
  const glow = useRef<MeshBasicMaterial>(null);
  const fillA = useRef<MeshStandardMaterial>(null);
  const fillB = useRef<MeshStandardMaterial>(null);
  const labelA = useRef<HTMLDivElement>(null);
  const labelB = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);

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
  const flat = useMemo(() => new ShapeGeometry(bubbleShape('right'), 16), []);
  const outline = useMemo(
    () =>
      bubbleShape('right')
        .getPoints(24)
        .map((v) => new Vector3(v.x, v.y, 0)),
    [],
  );

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const p = (t % PERIOD) / PERIOD;
    const attract = phase(p, 0.22, 0.48);
    const fuse = phase(p, 0.56, 0.7);
    const reset = phase(p, 0.9, 1);
    const drift = Math.sin(t * 0.9) * 0.06 * (1 - attract);

    if (a.current && b.current) {
      a.current.position.set(-1.55 + attract * 1.0, 0.32 + drift, 0);
      b.current.position.set(1.55 - attract * 1.0, -0.32 - drift, 0.25);
      const scale = 1 - fuse * 0.35;
      a.current.scale.setScalar(scale);
      b.current.scale.setScalar(scale);
    }
    if (root.current) root.current.rotation.y = Math.sin(t * 0.25) * 0.12;

    const visible = (1 - fuse) * (1 - reset) + reset;
    if (fillA.current) fillA.current.opacity = visible;
    if (fillB.current) fillB.current.opacity = 0.08 * visible;
    if (glow.current) glow.current.opacity = 0.55 * phase(p, 0.4, 0.52) * (1 - fuse);
    if (labelA.current) labelA.current.style.opacity = String(visible);
    if (labelB.current) labelB.current.style.opacity = String(visible);
    if (card.current) {
      const shown = fuse * (1 - reset);
      card.current.style.opacity = String(shown);
      card.current.style.transform = `scale(${0.9 + shown * 0.1})`;
    }
  });

  return (
    <group ref={root}>
      <group ref={a}>
        <mesh geometry={solid} position={[0, 0, -0.18]}>
          <meshStandardMaterial
            ref={fillA}
            color={colors['--color-exact']}
            transparent
            roughness={0.45}
          />
        </mesh>
        <Html transform center distanceFactor={4} position={[0, 0, 0.05]} zIndexRange={[1, 0]}>
          <div ref={labelA} className={`${styles.sceneLabel} ${styles.sceneLabelSolid}`}>
            What&apos;s the capital of France?
          </div>
        </Html>
      </group>
      <group ref={b}>
        <mesh geometry={flat}>
          <meshStandardMaterial
            ref={fillB}
            color={colors['--color-twin']}
            transparent
            opacity={0.08}
          />
        </mesh>
        <Line points={outline} color={colors['--color-twin']} lineWidth={2} />
        <Html transform center distanceFactor={4} position={[0, 0, 0.02]} zIndexRange={[1, 0]}>
          <div ref={labelB} className={styles.sceneLabel}>
            Which city is France&apos;s capital?
          </div>
        </Html>
      </group>
      {/* The only glow in the product: where the twins overlap. */}
      <mesh position={[0, 0, 0.12]}>
        <circleGeometry args={[0.75, 48]} />
        <meshBasicMaterial
          ref={glow}
          color={colors['--color-twin']}
          transparent
          opacity={0}
          blending={AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <Html center position={[0, 0, 0.4]} zIndexRange={[2, 0]}>
        <div ref={card} className={styles.sceneCard} style={{ opacity: 0 }}>
          <span className={styles.answerLabel}>Cached answer</span>
          <span>Paris is the capital of France.</span>
        </div>
      </Html>
    </group>
  );
}

/** The landing hero: two differently worded questions merge into one cached answer. */
export default function HeroScene() {
  const host = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(true);
  const colors = useTokenColors(['--color-exact', '--color-twin', '--color-surface'] as const);

  // Render only while the hero is on screen.
  useEffect(() => {
    const el = host.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) =>
      setInView(entry?.isIntersecting ?? true),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={host} className={styles.canvas} aria-hidden="true">
      <Canvas
        frameloop={inView ? 'always' : 'never'}
        dpr={[1, 2]}
        camera={{ position: [0, 0.4, 6], fov: 38 }}
        gl={{ antialias: true, alpha: true }}
      >
        <ambientLight intensity={1.4} />
        <directionalLight position={[3, 4, 5]} intensity={1.6} />
        <Twins colors={colors} />
      </Canvas>
    </div>
  );
}
