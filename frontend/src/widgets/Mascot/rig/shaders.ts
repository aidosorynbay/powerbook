/**
 * The living bookworm's shaders (2026-10-13). The founder's own renders are
 * the only picture of him there is: one textured plane that a vertex shader
 * warps (breath, a turn of the head about the neck, swaying antennae, a lean
 * toward the reader, a squash-and-stretch on a tap), and a fragment shader
 * that blinks with lids painted from his own fur and wipes the green render
 * over the orange one when today's minutes land. The orange and green renders
 * sit pixel on pixel, and the glasses frame is drawn from the orange one in
 * every frame, so the glasses can never vanish (the Flow films lost them).
 */

export const NOISE = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
`;

export const WORM_VERT = /* glsl */ `
uniform float uTime;
uniform float uBreath;   // 0..1, in and out
uniform float uBob;      // radians: the head about the neck
uniform float uSquash;   // -1..1, a tap's spring (minus = squashed)
uniform vec2 uLean;      // -1..1, toward the reader's finger or pointer
uniform vec2 uPivot;     // the neck, in uv
uniform vec2 uSize;      // the plane in world units
uniform sampler2D uMaps; // a: how much of the head a point is
varying vec2 vUv;

void main() {
  vUv = uv;
  float head = texture2D(uMaps, uv).a;
  vec2 q = uv;
  // the antennae and the crown sway, more the higher up
  float top = smoothstep(0.70, 1.0, uv.y);
  q.x += top * 0.014 * sin(uTime * 1.7 + uv.x * 5.0);
  // the head turns about the neck (in world units, so the turn is round)
  vec2 d = (q - uPivot) * uSize;
  float a = (uBob + uLean.x * 0.09) * head;
  float c = cos(a), s = sin(a);
  q = uPivot + vec2(c * d.x - s * d.y, s * d.x + c * d.y) / uSize;
  q.y += uLean.y * 0.025 * head;
  // breathing: the body swells up from the floor
  q.y *= 1.0 + 0.022 * uBreath;
  q.x = 0.5 + (q.x - 0.5) * (1.0 + 0.008 * uBreath);
  // a tap: squash and stretch from the floor
  q.y *= 1.0 + 0.16 * uSquash;
  q.x = 0.5 + (q.x - 0.5) * (1.0 - 0.09 * uSquash);
  vec3 p = vec3((q - 0.5) * uSize, 0.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

export const WORM_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uOrange;
uniform sampler2D uGreen;
uniform sampler2D uLidsOrange;
uniform sampler2D uLidsGreen;
uniform sampler2D uMaps;     // r: glasses frame, g: the eyes, b: the book, a: the head
uniform float uProgress;     // 0 orange … 1 green: the wipe runs from the tail to the head
uniform float uBlink;        // 0 open … 1 shut
uniform vec2 uGaze;          // -1..1 where the eyes look
uniform vec4 uEye0;          // cx, cy, rx, ry in uv
uniform vec4 uEye1;
uniform float uFade;         // the whole worm's opacity
varying vec2 vUv;
${NOISE}

float lidOver(vec4 e, vec2 uv) {
  vec2 d = (uv - e.xy) / e.zw;
  float inside = step(dot(d, d), 1.0);
  float line = e.y + e.w - uBlink * 2.2 * e.w;
  return inside * step(line, uv.y);
}

void main() {
  vec4 m = texture2D(uMaps, vUv);
  // the eyes glance: the eye's picture slides a little, never past the eye's rim
  vec2 shift = uGaze * vec2(0.011, 0.008) * m.g;
  float keep = step(0.5, texture2D(uMaps, vUv - shift).g);
  vec2 uvE = vUv - shift * keep;
  vec4 o = texture2D(uOrange, uvE);
  vec4 g = texture2D(uGreen, uvE);
  // a blink: fur lids come down over the eyes, under the frame
  float lid = max(lidOver(uEye0, vUv), lidOver(uEye1, vUv)) * m.g;
  o = mix(o, texture2D(uLidsOrange, vUv), lid);
  g = mix(g, texture2D(uLidsGreen, vUv), lid);
  // the green runs through him from the tail to the head, with a ragged, glowing front
  float n = vnoise(vUv * 7.0) * 0.6 + vnoise(vUv * 19.0) * 0.4;
  float front = uProgress * 1.35 - 0.18;
  float x = vUv.x + (n - 0.5) * 0.22;
  float wipe = 1.0 - smoothstep(front - 0.05, front + 0.05, x);
  vec4 col = mix(o, g, wipe);
  float moving = step(0.001, uProgress) * step(uProgress, 0.999);
  float glow = (1.0 - smoothstep(0.0, 0.07, abs(x - front))) * moving;
  col.rgb += glow * 0.32 * col.a;
  // the glasses frame, from the orange render, on top of everything
  vec4 frame = texture2D(uOrange, vUv);
  col = mix(col, frame, m.r);
  col.a *= uFade;
  gl_FragColor = col;
}
`;

export const WING_VERT = /* glsl */ `
uniform float uTime;
uniform float uHover;    // -1..1, the slow rise and fall
uniform float uFlap;     // -1..1, the wings opening and closing
uniform float uSquash;   // a tap
uniform vec2 uLean;
uniform vec2 uSize;
uniform vec2 uBody;      // where the body is, in uv: the wings hinge there
varying vec2 vUv;

void main() {
  vUv = uv;
  vec2 q = uv;
  float wing = smoothstep(uBody.x - 0.02, uBody.x + 0.25, uv.x);
  float high = smoothstep(0.3, 1.0, uv.y);
  q.x = uBody.x + (q.x - uBody.x) * (1.0 - 0.09 * (uFlap * 0.5 + 0.5) * wing);
  q.y += wing * high * 0.035 * uFlap;
  float top = smoothstep(0.72, 1.0, uv.y) * (1.0 - wing);
  q.x += top * 0.012 * sin(uTime * 1.9 + uv.x * 7.0);
  q.x += uLean.x * 0.02;
  q.y += uLean.y * 0.015 + uHover * 0.02;
  q.y *= 1.0 + 0.12 * uSquash;
  q.x = 0.5 + (q.x - 0.5) * (1.0 - 0.07 * uSquash);
  vec3 p = vec3((q - 0.5) * uSize, 0.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

export const WING_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uMap;
uniform float uFade;
varying vec2 vUv;
void main() {
  vec4 col = texture2D(uMap, vUv);
  col.a *= uFade;
  gl_FragColor = col;
}
`;

/**
 * The change into the butterfly: every opaque pixel of the caterpillar is a
 * particle that flies, swirling, to a pixel of the butterfly (Dala's explode
 * and assemble, on his own pixels). The glasses are particles too, and they
 * keep their shape on the way: they fly as one.
 */
export const FLIGHT_VERT = /* glsl */ `
attribute vec2 aFrom;
attribute vec2 aTo;
attribute vec3 aColorFrom;
attribute vec3 aColorTo;
attribute float aSeed;
attribute float aGlasses;
uniform float uT;        // 0..1
uniform float uDpr;
uniform float uScale;    // world units per css px of point size
uniform vec2 uGlassesFrom; // the middle of the glasses on the caterpillar
uniform vec2 uGlassesTo;   // the butterfly's eye, where they melt away
varying vec3 vColor;
varying float vAlpha;

float ease(float t) { return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0; }

void main() {
  float t = clamp(uT, 0.0, 1.0);
  float stagger = aSeed * 0.25;
  float e = ease(clamp((t - stagger) / 0.75, 0.0, 1.0));
  float lift = sin(e * 3.14159);
  // the swirl: each particle on its own little orbit in the middle of the flight
  float ang = aSeed * 40.0 + e * 6.0;
  vec2 swirl = vec2(cos(ang), sin(ang)) * (0.10 + 0.25 * fract(aSeed * 7.3)) * lift;
  vec2 drift = vec2(0.0, 0.35 * lift);
  vec2 p = mix(aFrom, aTo, e) + (swirl + drift) * (1.0 - aGlasses);
  // the glasses go as one piece, a touch later, shrinking into the butterfly's eye: he needs them no more
  float eg = ease(clamp((t - 0.3) / 0.6, 0.0, 1.0));
  vec2 gpos = mix(uGlassesFrom, uGlassesTo, eg) + (aFrom - uGlassesFrom) * (1.0 - 0.85 * eg) + vec2(0.0, 0.08 * sin(eg * 3.14159));
  p = mix(p, gpos, aGlasses);
  vColor = mix(mix(aColorFrom, aColorTo, e), aColorFrom, aGlasses);
  vAlpha = mix(1.0, 1.0 - smoothstep(0.8, 1.0, eg), aGlasses);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 0.0, 1.0);
  float size = (1.9 + 1.6 * lift) * uScale * uDpr;
  gl_PointSize = mix(size, size * (1.0 - 0.5 * eg), aGlasses);
}
`;

export const FLIGHT_FRAG = /* glsl */ `
precision highp float;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float a = 1.0 - smoothstep(0.35, 0.5, length(d));
  gl_FragColor = vec4(vColor, a * vAlpha);
}
`;
