/**
 * The living bookworm: the founder's renders brought to life in WebGL
 * (2026-10-13, after the Flow films were turned down). One plane for the
 * caterpillar, one for the butterfly, a cloud of particles for the change
 * between them, an orthographic camera, one draw call at rest.
 *
 * Loaded lazily (three.js is not in the first paint of /round): the page
 * shows the still picture until the first frame is drawn.
 */
import * as THREE from 'three';
import { FLIGHT_FRAG, FLIGHT_VERT, WING_FRAG, WING_VERT, WORM_FRAG, WORM_VERT } from './shaders';

export type Stage = 'caterpillar' | 'butterfly';
export type Colour = 'orange' | 'green';

const BASE = '/mascot';
// Measured on the renders (marketing/2026-10-mascot/rig_assets.py); uv with y up.
const WORM = {
  aspect: 1117 / 932,
  pivot: [0.734, 0.4],
  eye0: [0.6097, 1 - 0.3407, 0.0859, 0.081],
  eye1: [0.8621, 1 - 0.3568, 0.0519, 0.0756],
  // the glasses' box on the render, uv with y up
  glasses: [0.522, 1 - 0.47, 0.943, 1 - 0.2135],
};
const FLY: Record<Colour, { aspect: number; body: number[]; eye: number[] }> = {
  orange: { aspect: 1024 / 907, body: [0.36, 0.45], eye: [0.315, 1 - 0.489] },
  green: { aspect: 865 / 669, body: [0.38, 0.4], eye: [0.332, 1 - 0.605] },
};
// How much of the frame the worm takes; the rest is room for the bob and the stretch.
const FIT = 0.94;
const FLIGHT_SECONDS = 3.2;

export interface RigEvents {
  onReady?: () => void;
  onLost?: () => void;
  onTurnEnd?: () => void;
  onFlightEnd?: () => void;
}

/** A damped spring toward a target, for taps and nods. */
class Spring {
  v = 0;
  x = 0;
  constructor(
    public k = 120,
    public d = 14,
  ) {}
  step(target: number, dt: number) {
    const a = this.k * (target - this.x) - this.d * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
    return this.x;
  }
}

function blinkAmt(t: number): number {
  // shut in 85 ms, hold, open in 185 ms (the reading room's curve)
  if (t < 0) return 0;
  if (t < 0.085) return (t / 0.085) ** 2;
  if (t < 0.125) return 1;
  if (t < 0.31) return (1 - (t - 0.125) / 0.185) ** 2;
  return 0;
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function loadTexture(url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      (t) => {
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.magFilter = THREE.LinearFilter;
        t.generateMipmaps = true;
        t.anisotropy = 4;
        resolve(t);
      },
      undefined,
      reject,
    );
  });
}

interface Cloud {
  pos: Float32Array;
  col: Float32Array;
  uv: Float32Array;
}

/** The opaque pixels of a picture as a cloud of positions and colours, the same every time. */
function samplePixels(image: HTMLImageElement, n: number, aspect: number): Cloud {
  const W = 160;
  const H = Math.round(W / aspect);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0, W, H);
  const data = ctx.getImageData(0, 0, W, H).data;
  const cand: number[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (data[(y * W + x) * 4 + 3] > 140) cand.push(y * W + x);
  const pos = new Float32Array(n * 2);
  const col = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const sw = FIT * 2;
  const sh = sw / aspect;
  for (let i = 0; i < n; i++) {
    const k = cand[(i * 7919 + ((i * 104729) % 7)) % cand.length];
    const x = k % W;
    const y = Math.floor(k / W);
    const u = (x + 0.5) / W;
    const v = 1 - (y + 0.5) / H;
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
    pos[i * 2] = (u - 0.5) * sw;
    pos[i * 2 + 1] = (v - 0.5) * sh;
    col[i * 3] = data[k * 4] / 255;
    col[i * 3 + 1] = data[k * 4 + 1] / 255;
    col[i * 3 + 2] = data[k * 4 + 2] / 255;
  }
  return { pos, col, uv };
}

export class WormRig {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
  private worm?: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private wings?: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private flight?: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private textures: Record<string, THREE.Texture> = {};
  private maps?: THREE.Texture;
  private raf = 0;
  private last = 0;
  private time = 0;
  private running = false;
  private visible = true;
  private frozen = false;
  private disposed = false;
  ready = false;

  stage: Stage = 'caterpillar';
  colour: Colour = 'orange';
  private progress = 0; // the wipe
  private turnT: number | null = null;
  private flightT: number | null = null;
  private flightTo: Colour = 'green';
  private flightStage: Stage = 'butterfly';

  // life
  private blinkAt = -9;
  private blinkNext = 1.5;
  private blinkK = 1;
  private gaze = new THREE.Vector2();
  private gazeTarget = new THREE.Vector2();
  private gazeNext = 2;
  private pointerGaze: THREE.Vector2 | null = null;
  private pointerAt = -99;
  private lean = new THREE.Vector2();
  private leanTarget = new THREE.Vector2();
  private squash = new Spring(160, 9);
  private squashKick = 0;
  private bobSpring = new Spring(90, 8);
  private bobKick = 0;
  private hello = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private size: number,
    private events: RigEvents = {},
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
    this.renderer.setClearColor(0x000000, 0);
    this.resize(size);
    canvas.addEventListener('webglcontextlost', this.onLost, false);
    canvas.addEventListener('pointerdown', this.onTap);
    window.addEventListener('pointermove', this.onPointer, { passive: true });
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  resize(size: number) {
    this.size = size;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(size, size, false);
    this.canvas.style.width = `${size}px`;
    this.canvas.style.height = `${size}px`;
    if (this.flight) this.flight.material.uniforms.uScale.value = size / 160;
  }

  private async texture(name: string): Promise<THREE.Texture> {
    if (!this.textures[name]) this.textures[name] = await loadTexture(`${BASE}/${name}.${name.endsWith('maps') ? 'png' : 'webp'}`);
    return this.textures[name];
  }

  private async textures_for(stage: Stage, colour: Colour): Promise<void> {
    const names = stage === 'caterpillar' ? ['caterpillar-orange', 'caterpillar-green', 'caterpillar-lids-orange', 'caterpillar-lids-green'] : [`butterfly-${colour}`];
    const [maps] = await Promise.all([this.texture('caterpillar-maps'), ...names.map((n) => this.texture(n))]);
    maps.minFilter = THREE.LinearFilter;
    maps.generateMipmaps = false;
    this.maps = maps;
  }

  async load(stage: Stage, colour: Colour): Promise<void> {
    await this.textures_for(stage, colour);
    if (this.disposed) return;
    this.show(stage, colour);
    this.ready = true;
    this.start();
    this.events.onReady?.();
  }

  /** Put a stage on the screen, no ceremony. */
  private show(stage: Stage, colour: Colour) {
    this.clearMeshes();
    this.stage = stage;
    this.colour = colour;
    this.turnT = null;
    this.flightT = null;
    this.progress = colour === 'green' ? 1 : 0;
    if (stage === 'caterpillar') this.buildWorm();
    else this.buildWings(colour);
  }

  /** The page moved to another stage without the flight (a preview, a new circle). */
  async setStage(stage: Stage, colour: Colour): Promise<void> {
    if (this.stage === stage && this.flightT === null) {
      this.setColour(colour);
      return;
    }
    await this.textures_for(stage, colour);
    if (this.disposed) return;
    this.show(stage, colour);
  }

  private clearMeshes() {
    for (const m of [this.worm, this.wings, this.flight]) {
      if (!m) continue;
      this.scene.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    }
    this.worm = this.wings = this.flight = undefined;
  }

  private buildWorm() {
    const w = FIT * 2;
    const h = w / WORM.aspect;
    const geo = new THREE.PlaneGeometry(w, h, 48, 40);
    const mat = new THREE.ShaderMaterial({
      vertexShader: WORM_VERT,
      fragmentShader: WORM_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uTime: { value: 0 },
        uBreath: { value: 0 },
        uBob: { value: 0 },
        uSquash: { value: 0 },
        uLean: { value: new THREE.Vector2() },
        uPivot: { value: new THREE.Vector2(WORM.pivot[0], WORM.pivot[1]) },
        uSize: { value: new THREE.Vector2(w, h) },
        uMaps: { value: this.maps },
        uOrange: { value: this.textures['caterpillar-orange'] },
        uGreen: { value: this.textures['caterpillar-green'] },
        uLidsOrange: { value: this.textures['caterpillar-lids-orange'] },
        uLidsGreen: { value: this.textures['caterpillar-lids-green'] },
        uProgress: { value: this.progress },
        uBlink: { value: 0 },
        uGaze: { value: new THREE.Vector2() },
        uEye0: { value: new THREE.Vector4(...WORM.eye0) },
        uEye1: { value: new THREE.Vector4(...WORM.eye1) },
        uFade: { value: 1 },
      },
    });
    this.worm = new THREE.Mesh(geo, mat);
    this.worm.position.y = -0.04;
    this.scene.add(this.worm);
  }

  private buildWings(colour: Colour, fade = 1) {
    const spec = FLY[colour];
    const w = FIT * 2;
    const h = w / spec.aspect;
    const geo = new THREE.PlaneGeometry(w, h, 40, 36);
    const mat = new THREE.ShaderMaterial({
      vertexShader: WING_VERT,
      fragmentShader: WING_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uTime: { value: 0 },
        uHover: { value: 0 },
        uFlap: { value: 0 },
        uSquash: { value: 0 },
        uLean: { value: new THREE.Vector2() },
        uSize: { value: new THREE.Vector2(w, h) },
        uBody: { value: new THREE.Vector2(spec.body[0], spec.body[1]) },
        uMap: { value: this.textures[`butterfly-${colour}`] },
        uFade: { value: fade },
      },
    });
    if (this.wings) {
      this.scene.remove(this.wings);
      this.wings.geometry.dispose();
      this.wings.material.dispose();
    }
    this.wings = new THREE.Mesh(geo, mat);
    this.scene.add(this.wings);
  }

  /** Today's minutes landed: the green runs through him once. */
  turn() {
    if (this.stage !== 'caterpillar' || this.progress >= 1 || this.flightT !== null) return;
    this.turnT = 0;
    this.pointerGaze = null;
    this.gazeTarget.set(0, 0);
  }

  /** The colour without ceremony on the caterpillar; the butterfly's pixels take flight to change. */
  setColour(colour: Colour) {
    if (this.colour === colour && this.turnT === null) return;
    this.turnT = null;
    if (this.stage === 'caterpillar') {
      this.colour = colour;
      this.progress = colour === 'green' ? 1 : 0;
      if (this.worm) this.worm.material.uniforms.uProgress.value = this.progress;
    } else {
      void this.fly(colour);
    }
  }

  /**
   * The 25th day: his pixels fly apart and come together as the butterfly.
   * (The butterfly changes colour the same way: every pixel takes flight.)
   */
  async fly(to: Colour) {
    if (this.flightT !== null) return;
    const fromStage = this.stage;
    const fromColour = this.colour;
    if (fromStage === 'butterfly' && fromColour === to) return;
    this.flightTo = to;
    this.flightStage = 'butterfly';
    await this.texture(`butterfly-${to}`);
    if (this.disposed || this.flightT !== null) return;
    const src = fromStage === 'caterpillar' ? `caterpillar-${fromColour}` : `butterfly-${fromColour}`;
    const srcAspect = fromStage === 'caterpillar' ? WORM.aspect : FLY[fromColour].aspect;
    this.buildFlight(src, srcAspect, fromStage === 'caterpillar', to);
    this.flightT = 0;
  }

  private buildFlight(src: string, srcAspect: number, withGlasses: boolean, to: Colour) {
    const N = 14000;
    const from = samplePixels(this.textures[src].image as HTMLImageElement, N, srcAspect);
    const spec = FLY[to];
    const dest = samplePixels(this.textures[`butterfly-${to}`].image as HTMLImageElement, N, spec.aspect);
    // pair the pixels so that near pixels fly to near pixels: both sorted by their angle around the middle
    const order = (p: Float32Array) =>
      Array.from({ length: N }, (_, i) => i).sort((a, b) => Math.atan2(p[a * 2 + 1], p[a * 2]) - Math.atan2(p[b * 2 + 1], p[b * 2]));
    const oa = order(from.pos);
    const ob = order(dest.pos);
    const aFrom = new Float32Array(N * 2);
    const aTo = new Float32Array(N * 2);
    const cFrom = new Float32Array(N * 3);
    const cTo = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    const glasses = new Float32Array(N);
    const g = WORM.glasses;
    for (let i = 0; i < N; i++) {
      const a = oa[i];
      const b = ob[i];
      aFrom.set(from.pos.subarray(a * 2, a * 2 + 2), i * 2);
      aTo.set(dest.pos.subarray(b * 2, b * 2 + 2), i * 2);
      cFrom.set(from.col.subarray(a * 3, a * 3 + 3), i * 3);
      cTo.set(dest.col.subarray(b * 3, b * 3 + 3), i * 3);
      seed[i] = ((a * 2654435761) % 1000) / 1000;
      if (withGlasses) {
        // the dark frame of the glasses flies as one piece
        const u = from.uv[a * 2];
        const v = from.uv[a * 2 + 1];
        const inBox = u >= g[0] && v >= g[1] && u <= g[2] && v <= g[3];
        const dark = cFrom[i * 3] + cFrom[i * 3 + 1] + cFrom[i * 3 + 2] < 0.55;
        glasses[i] = inBox && dark ? 1 : 0;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    geo.setAttribute('aFrom', new THREE.BufferAttribute(aFrom, 2));
    geo.setAttribute('aTo', new THREE.BufferAttribute(aTo, 2));
    geo.setAttribute('aColorFrom', new THREE.BufferAttribute(cFrom, 3));
    geo.setAttribute('aColorTo', new THREE.BufferAttribute(cTo, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    geo.setAttribute('aGlasses', new THREE.BufferAttribute(glasses, 1));
    // the glasses fly to the butterfly's eye and melt into it: he needs them no more
    const gw = FIT * 2;
    const gh = gw / WORM.aspect;
    const gc = [((g[0] + g[2]) / 2 - 0.5) * gw, ((g[1] + g[3]) / 2 - 0.5) * gh];
    const bw = FIT * 2;
    const bh = bw / spec.aspect;
    const eye = [(spec.eye[0] - 0.5) * bw, (spec.eye[1] - 0.5) * bh];
    const mat = new THREE.ShaderMaterial({
      vertexShader: FLIGHT_VERT,
      fragmentShader: FLIGHT_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uT: { value: 0 },
        uDpr: { value: Math.min(window.devicePixelRatio || 1, 2) },
        uScale: { value: this.size / 160 },
        uGlassesFrom: { value: new THREE.Vector2(gc[0], gc[1]) },
        uGlassesTo: { value: new THREE.Vector2(eye[0], eye[1]) },
      },
    });
    if (this.flight) {
      this.scene.remove(this.flight);
      this.flight.geometry.dispose();
      this.flight.material.dispose();
    }
    this.flight = new THREE.Points(geo, mat);
    this.scene.add(this.flight);
  }

  private endFlight() {
    const to = this.flightTo;
    this.clearMeshes();
    this.stage = this.flightStage;
    this.colour = to;
    this.flightT = null;
    this.buildWings(to, 0);
    this.squashKick = 0.5;
    this.events.onFlightEnd?.();
  }

  /** For the review strips: hold the wipe or the flight at a point. */
  scrub(progress: number, flight?: number) {
    this.turnT = null;
    this.progress = progress;
    if (flight !== undefined && this.flight) this.flightT = flight;
  }

  /** Freeze the clock and the life for a strip (a pose can then be set); thaw() lets him live again. */
  freeze(at: number) {
    this.frozen = true;
    this.stop();
    this.time = at;
    this.blinkAt = -9;
    this.blinkNext = 1e9;
    this.gazeNext = 1e9;
    this.pointerGaze = null;
    this.gazeTarget.set(0, 0.05);
    this.gaze.copy(this.gazeTarget);
    this.lean.set(0, 0);
    this.leanTarget.set(0, 0);
    this.squashKick = 0;
    this.squash.x = this.squash.v = 0;
    this.bobKick = 0;
    this.bobSpring.x = this.bobSpring.v = 0;
    this.pose({});
  }

  /** One drawn pose while frozen. */
  pose(p: { blink?: number; gaze?: [number, number]; lean?: [number, number]; squash?: number; flight?: number }) {
    if (p.blink !== undefined) this.blinkAt = this.time - (p.blink > 0 ? 0.1 : 9);
    if (p.gaze) this.gazeTarget.copy(this.gaze.set(p.gaze[0], p.gaze[1]));
    if (p.lean) this.leanTarget.copy(this.lean.set(p.lean[0], p.lean[1]));
    if (p.squash !== undefined) this.squashKick = p.squash;
    if (p.flight !== undefined && this.flight) this.flightT = p.flight;
    this.step(0);
    this.renderer.render(this.scene, this.camera);
  }

  thaw() {
    this.frozen = false;
    this.blinkNext = this.time + 1;
    this.gazeNext = this.time + 1;
    this.start();
  }

  /** A wave hello: a bounce and a blink, for the front page. */
  sayHello() {
    this.hello = 1.2;
    this.squashKick = 0.55;
    this.blinkAt = this.time + 0.4;
  }

  setVisible(v: boolean) {
    this.visible = v;
    if (v) this.start();
    else this.stop();
  }

  private onVisibility = () => this.setVisible(this.visible && document.visibilityState === 'visible');

  private onLost = (e: Event) => {
    e.preventDefault();
    this.stop();
    this.events.onLost?.();
  };

  private onTap = (e: PointerEvent) => {
    e.preventDefault();
    this.squashKick = this.stage === 'butterfly' ? -0.6 : -0.9;
    this.bobKick = 0.25;
    this.blinkAt = this.time + 0.25;
    this.gazeTarget.set(0, 0.2);
    this.pointerGaze = null;
  };

  private onPointer = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    const r = this.canvas.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) / 260;
    const dy = (r.top + r.height / 2 - e.clientY) / 220;
    this.pointerGaze = new THREE.Vector2(THREE.MathUtils.clamp(dx, -1, 1), THREE.MathUtils.clamp(dy, -1, 1));
    this.pointerAt = this.time;
  };

  private start() {
    if (this.running || !this.ready || !this.visible || this.frozen || this.disposed) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private frame = (now: number) => {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    this.step(dt);
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.frame);
  };

  private step(dt: number) {
    const t = this.time;
    // blinks, now and then twice
    if (t > this.blinkNext) {
      this.blinkAt = t;
      this.blinkK = 0.9 + Math.random() * 0.1;
      this.blinkNext = t + (Math.random() < 0.15 ? 0.36 : 2.6 + Math.random() * 4);
    }
    const blink = blinkAmt(t - this.blinkAt) * this.blinkK;
    // where he looks: the reader's pointer while it moves, otherwise the book and the reader in turn
    if (this.pointerGaze && t - this.pointerAt < 4) {
      this.gazeTarget.copy(this.pointerGaze);
      this.leanTarget.set(this.pointerGaze.x * 0.6, this.pointerGaze.y * 0.4);
    } else if (!this.frozen) {
      this.leanTarget.set(0, 0);
      if (t > this.gazeNext) {
        const r = Math.random();
        if (r < 0.5) this.gazeTarget.set(0.45, -0.75); // the book
        else if (r < 0.85) this.gazeTarget.set(0, 0.05); // the reader
        else this.gazeTarget.set(Math.random() * 1.4 - 0.7, Math.random() * 0.8 - 0.3);
        this.gazeNext = t + 1.8 + Math.random() * 3.5;
      }
    }
    if (dt > 0) {
      this.gaze.lerp(this.gazeTarget, 1 - Math.exp(-dt * 7));
      this.lean.lerp(this.leanTarget, 1 - Math.exp(-dt * 4));
    }
    // the tap's spring and the head's nod
    const sq = this.squash.step(0, dt) + this.squashKick;
    this.squashKick *= Math.exp(-dt * 9);
    if (Math.abs(this.squashKick) < 0.01) this.squashKick = 0;
    const bob = this.bobSpring.step(0, dt) + this.bobKick;
    this.bobKick *= Math.exp(-dt * 6);
    const idleBob = 0.035 * Math.sin(t * 0.9) + 0.02 * Math.sin(t * 2.3 + 1);
    const helloBob = this.hello > 0 ? 0.12 * Math.sin(this.hello * 14) * this.hello : 0;
    this.hello = Math.max(0, this.hello - dt);
    const breath = 0.5 + 0.5 * Math.sin(t * 1.5);

    if (this.worm) {
      const u = this.worm.material.uniforms;
      u.uTime.value = t;
      u.uBreath.value = breath;
      u.uBob.value = idleBob + bob + helloBob;
      u.uSquash.value = sq;
      u.uLean.value.copy(this.lean);
      u.uBlink.value = blink;
      u.uGaze.value.copy(this.gaze);
      if (this.turnT !== null) {
        const before = this.turnT;
        this.turnT += dt / 1.7;
        this.progress = easeInOut(Math.min(1, this.turnT));
        if (before < 0.78 && this.turnT >= 0.78) {
          // the front reaches the face: a little hop and a blink
          this.squashKick = 0.5;
          this.blinkAt = t;
          this.gazeTarget.set(0, 0.1);
        }
        if (this.turnT >= 1.15) {
          this.turnT = null;
          this.progress = 1;
          this.colour = 'green';
          this.events.onTurnEnd?.();
        }
      }
      u.uProgress.value = this.progress;
      u.uFade.value = this.flightT === null ? 1 : Math.max(0, 1 - this.flightT * 6);
    }
    if (this.wings) {
      const u = this.wings.material.uniforms;
      u.uTime.value = t;
      u.uHover.value = Math.sin(t * 1.3);
      u.uFlap.value = Math.sin(t * 1.1);
      u.uSquash.value = sq;
      u.uLean.value.copy(this.lean);
      const fading = this.flightT !== null ? Math.max(0, 1 - this.flightT * 6) : Math.min(1, u.uFade.value + dt * 3);
      u.uFade.value = fading;
    }
    if (this.flight && this.flightT !== null) {
      if (dt > 0) this.flightT += dt / FLIGHT_SECONDS;
      this.flight.material.uniforms.uT.value = this.flightT;
      if (this.flightT >= 1.05) this.endFlight();
    }
  }

  dispose() {
    this.disposed = true;
    this.stop();
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('pointerdown', this.onTap);
    window.removeEventListener('pointermove', this.onPointer);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.clearMeshes();
    for (const t of Object.values(this.textures)) t.dispose();
    this.renderer.dispose();
  }
}

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}
