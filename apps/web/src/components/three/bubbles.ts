import { Shape } from 'three';

/** Bubble size, in scene units, shared by every 3D twin-bubble scene. */
const W = 2.3;
const H = 1.05;
const R = 0.32;

/** A speech bubble outline: a rounded rectangle with a tail at the bottom left or right. */
export function bubbleShape(tail: 'left' | 'right'): Shape {
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
