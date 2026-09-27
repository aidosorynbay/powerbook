/**
 * The bookcase as a WebGL scene: one long walnut shelf, every book standing
 * spine-out, and the chosen one drawn forward and turned to face the reader.
 *
 * Inspired by jcarbonell.com/bookshelf. Written for PowerBook's shelves,
 * which differ in two ways that shape everything here: most books have no
 * cover image (so all art is painted, see bookArt.ts), and a long-standing
 * reader's shelf holds well over a hundred volumes — so textures are painted
 * lazily around the book in view, and frames are only drawn while something
 * is actually moving.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  type Palette,
  type VolumeArt,
  dimensionsFor,
  loadImage,
  paintBack,
  paintFront,
  paintSpine,
  paintWood,
  paletteFor,
  paletteFromImage,
} from './bookArt';

export type SceneVolume = { art: VolumeArt; hasFile: boolean };
export type SceneMode = 'browse' | 'focusing' | 'inspect' | 'returning';

export type SceneCallbacks = {
  onActive: (index: number) => void;
  onMode: (mode: SceneMode) => void;
  onReady: () => void;
  onContextLost: () => void;
  /**
   * The part of the screen, in CSS pixels, left free for a book held up for
   * inspection — beside the details panel on a desktop, above it on a phone.
   */
  focusArea: () => { left: number; top: number; right: number; bottom: number };
};

// The site's page colour: the canvas is transparent and the page shows through.
const ROOM = '#0d1117';
// The reading lamp: warm light that follows the mouse, or rests on the chosen book.
const LAMP_COLOR = '#ffc98c';
const LAMP_POWER = 55;
const PAGES = '#f2e8d4';
const RIBBON = '#f26430';

// Where spines line up, and the pose stages a book passes through as it is
// drawn off the shelf: slide straight out, turn once clear of its
// neighbours, then settle back towards the shelf facing the reader.
const SPINE_Z = 0.06;
const SLIDE_END = 0.34;
const TURN_END = 0.72;
const BOTTOM = 0.315;
const GAP = 0.045;

const LOOK_AT = new THREE.Vector3(0, 1.3, 0.1);

const clamp = THREE.MathUtils.clamp;
const smooth = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
const easeOut = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const damp = (from: number, to: number, lambda: number, dt: number) => THREE.MathUtils.damp(from, to, lambda, dt);

type RuntimeBook = {
  volume: SceneVolume;
  index: number;
  x: number;
  width: number;
  height: number;
  thickness: number;
  palette: Palette;
  slot: THREE.Group;
  content: THREE.Group;
  idle: THREE.Group;
  boardMaterial: THREE.MeshStandardMaterial;
  spineArt: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  frontArt: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  backArt: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  pick: THREE.Mesh;
  geometries: THREE.BufferGeometry[];
  /** 0 on the shelf, 1 presented cover-out. */
  pull: number;
  hover: number;
  hoverTarget: number;
  idleAmount: number;
  spineReady: boolean;
  facesReady: boolean;
  /** Small cover: spine colours, and the front until the full one lands. */
  coverThumb: HTMLImageElement | null;
  /** Full cover, held only while the book is near the one in front. */
  coverFull: HTMLImageElement | null;
  thumbState: 'idle' | 'loading' | 'done';
  fullState: 'idle' | 'loading' | 'done';
  lastNear: number;
};

export class BookcaseScene {
  private canvas: HTMLCanvasElement;
  private callbacks: SceneCallbacks;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(27, 1, 0.08, 80);
  private controls: OrbitControls;
  private shelfGroup = new THREE.Group();
  private furniture = new THREE.Group();
  private books: RuntimeBook[] = [];
  private pickTargets: THREE.Object3D[] = [];
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2(10, 10);
  private shared: {
    pageMaterial: THREE.MeshStandardMaterial;
    ribbonMaterial: THREE.MeshStandardMaterial;
    pickMaterial: THREE.MeshBasicMaterial;
    unitBox: THREE.BoxGeometry;
    ribbonHang: THREE.ShapeGeometry;
    ribbonTop: THREE.PlaneGeometry;
  };
  private woodTexture: THREE.CanvasTexture | null = null;
  private plankTexture: THREE.Texture | null = null;
  private furnitureGeometries: THREE.BufferGeometry[] = [];

  private mode: SceneMode = 'browse';
  private activeIndex = 0;
  private scroll = 0;
  private scrollTarget = 0;
  private presentTarget: number | null = null;
  private selected: number | null = null;
  private pendingFocus: number | null = null;
  private focusT = 0;
  private laneZ = 0.9;
  private presentZ = 0.4;

  private browseCamera = new THREE.Vector3(0, 1.46, 6.9);
  private focusCamera = new THREE.Vector3();
  private focusTarget = new THREE.Vector3();
  private focusDistance = 6.2;

  private pointerDown = false;
  private pointerId: number | null = null;
  private pointerStartX = 0;
  private pointerLastX = 0;
  private pointerTravel = 0;
  private lastInput = 0;
  private hoverDirty = false;

  private frame = 0;
  private lastTime = 0;
  private needsRender = true;
  private volumesSetAt = 0;
  private imagesInFlight = 0;
  private ready = false;
  private disposed = false;
  private reducedMotion: boolean;
  private resizeObserver: ResizeObserver;

  private lamp = new THREE.SpotLight(LAMP_COLOR, LAMP_POWER, 0, 0.42, 0.85, 2);
  private lampAim = new THREE.Vector3(Number.NaN, 0, 0);
  private lampGoal = new THREE.Vector3();
  private lampFollowsPointer = false;
  // Roughly the plane of the spines, so the pool lands where the mouse points.
  private lampPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -0.35);
  private lampScreen = new THREE.Vector3();

  // On a phone: the band the page leaves free between its header row and the
  // caption, in canvas pixels. The shelf is framed inside it while browsing.
  private browseBand: { top: number; bottom: number } | null = null;
  private tallest = 1.2;
  private viewOffsetY = 0;
  private framedWidth = 0;

  constructor(canvas: HTMLCanvasElement, volumes: SceneVolume[], callbacks: SceneCallbacks, startIndex = 0) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Transparent: the page's own background shows through, so the room and the
    // panels around it are one colour, not two that nearly match.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Neutral keeps the covers the colours they are in the 2D lists.
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enabled = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minPolarAngle = 0.22 * Math.PI;
    this.controls.maxPolarAngle = 0.78 * Math.PI;
    this.controls.addEventListener('change', this.invalidate);

    this.shared = {
      pageMaterial: new THREE.MeshStandardMaterial({ color: PAGES, roughness: 0.92, metalness: 0 }),
      ribbonMaterial: new THREE.MeshStandardMaterial({ color: RIBBON, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide }),
      pickMaterial: new THREE.MeshBasicMaterial(),
      unitBox: new THREE.BoxGeometry(1, 1, 1),
      ribbonHang: BookcaseScene.ribbonShape(),
      ribbonTop: new THREE.PlaneGeometry(0.2, 0.05),
    };

    this.setupScene();
    this.setVolumes(volumes, startIndex);

    canvas.addEventListener('webglcontextlost', this.handleContextLost);
    canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointermove', this.handlePointerMove);
    canvas.addEventListener('pointerup', this.handlePointerUp);
    canvas.addEventListener('pointercancel', this.handlePointerCancel);
    canvas.addEventListener('pointerleave', this.handlePointerLeave);
    canvas.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('blur', this.handlePointerCancel);

    this.resizeObserver = new ResizeObserver(this.handleResize);
    this.resizeObserver.observe(canvas);
    this.handleResize();
    this.frame = requestAnimationFrame(this.animate);
  }

  // ---------- scene ----------

  private static ribbonShape(): THREE.ShapeGeometry {
    // A satin ribbon hanging over the spine, cut swallowtail at the end.
    const w = 0.05;
    const len = 0.36;
    const s = new THREE.Shape();
    s.moveTo(-w / 2, 0);
    s.lineTo(w / 2, 0);
    s.lineTo(w / 2, -len);
    s.lineTo(0, -len + 0.035);
    s.lineTo(-w / 2, -len);
    s.closePath();
    return new THREE.ShapeGeometry(s);
  }

  private setupScene() {
    this.scene.fog = new THREE.Fog(ROOM, 14, 34);

    // A dim evening room: enough light to read every spine, the lamp does the rest.
    this.scene.add(new THREE.HemisphereLight('#9aa6bd', '#2b2119', 1.05));

    const key = new THREE.DirectionalLight('#dfe6f2', 1.35);
    key.position.set(-4.2, 7.4, 5.5);
    key.castShadow = true;
    const small = window.innerWidth < 760;
    key.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
    Object.assign(key.shadow.camera, { left: -8, right: 8, top: 6, bottom: -2, near: 0.5, far: 24 });
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.02;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight('#6c7a92', 0.55);
    fill.position.set(5, 3, -4);
    this.scene.add(fill);

    const warm = new THREE.PointLight('#e2a27a', 0.35, 10, 2);
    warm.position.set(-3, 0.5, 3.2);
    this.scene.add(warm);

    // No shadow from the lamp: a second shadow map would cost phones too much.
    this.lamp.penumbra = 0.85;
    this.scene.add(this.lamp, this.lamp.target);

    // Only behind the books: below the shelf a shadow has nothing to explain.
    const wallGeo = new THREE.PlaneGeometry(40, 14);
    // Wall and floor only exist to catch shadows; their colour is the page's.
    const wall = new THREE.Mesh(wallGeo, new THREE.ShadowMaterial({ color: '#000000', opacity: 0.4 }));
    wall.position.set(0, 7.3, -2.2);
    wall.receiveShadow = true;
    this.scene.add(wall);

    this.furnitureGeometries.push(wallGeo);

    this.woodTexture = new THREE.CanvasTexture(paintWood());
    this.woodTexture.colorSpace = THREE.SRGBColorSpace;
    this.woodTexture.wrapS = THREE.RepeatWrapping;
    this.woodTexture.wrapT = THREE.RepeatWrapping;
    this.woodTexture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());

    this.scene.add(this.shelfGroup);
    this.shelfGroup.add(this.furniture);
  }

  private clearFurniture() {
    this.furniture.children.slice().forEach((child) => {
      this.furniture.remove(child);
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
      (mesh.material as THREE.Material)?.dispose();
    });
    this.plankTexture?.dispose();
    this.plankTexture = null;
  }

  private buildFurniture(length: number) {
    this.clearFurniture();
    const total = length + 9;
    const wood = this.woodTexture!.clone();
    this.plankTexture = wood;
    wood.repeat.set(Math.max(3, total / 3.2), 1);
    wood.needsUpdate = true;
    const plankGeo = new RoundedBoxGeometry(total, 0.2, 2.4, 4, 0.05);
    const plank = new THREE.Mesh(
      plankGeo,
      new THREE.MeshStandardMaterial({ color: '#ffffff', map: wood, bumpMap: wood, bumpScale: 0.012, roughness: 0.5, metalness: 0 })
    );
    plank.position.set(length / 2, 0.21, -0.26);
    plank.castShadow = true;
    plank.receiveShadow = true;
    this.furniture.add(plank);
  }

  private disposeBooks() {
    for (const book of this.books) {
      this.shelfGroup.remove(book.slot);
      book.geometries.forEach((g) => g.dispose());
      book.boardMaterial.dispose();
      for (const art of [book.spineArt, book.frontArt, book.backArt]) {
        art.material.map?.dispose();
        art.material.dispose();
      }
    }
    this.books = [];
    this.pickTargets = [];
  }

  /** Put a new set of books on the shelf (a re-sort, a filter, an upload). */
  setVolumes(volumes: SceneVolume[], startIndex = 0) {
    this.disposeBooks();
    let x = 0;
    let widest = 0;
    let thickest = 0;
    volumes.forEach((volume, index) => {
      const dims = dimensionsFor(volume.art.seed);
      x += dims.thickness / 2;
      const book = this.createBook(volume, index, x, dims);
      this.books.push(book);
      this.shelfGroup.add(book.slot);
      x += dims.thickness / 2 + GAP;
      widest = Math.max(widest, 0.5 * Math.hypot(dims.width, dims.thickness));
      thickest = Math.max(thickest, dims.thickness);
    });
    this.tallest = Math.max(1, ...this.books.map((b) => b.height));
    this.laneZ = SPINE_Z + widest * 1.06 + 0.05;
    this.presentZ = SPINE_Z + thickest / 2 + 0.22;
    this.buildFurniture(Math.max(x, 1));

    const start = clamp(startIndex, 0, Math.max(0, this.books.length - 1));
    this.scroll = this.scrollTarget = start;
    this.activeIndex = start;
    this.selected = null;
    this.pendingFocus = null;
    this.focusT = 0;
    if (this.mode !== 'browse') this.setMode('browse');
    this.controls.enabled = false;
    this.setOffset(0, this.browseOffsetY());
    this.camera.position.copy(this.browseCamera);
    this.camera.lookAt(LOOK_AT);
    // The first book is already out when the shelf appears, not pulled in
    // front of the reader on arrival.
    const first = this.books[start];
    if (first) first.pull = 1;
    this.books.forEach((b) => this.applyPose(b));
    this.callbacks.onActive(start);
    this.ready = false;
    this.volumesSetAt = performance.now();
    this.invalidate();
  }

  private createBook(volume: SceneVolume, index: number, x: number, dims: { width: number; height: number; thickness: number }): RuntimeBook {
    const { width: w, height: h, thickness: t } = dims;
    const palette = paletteFor(volume.art.seed);

    const slot = new THREE.Group();
    slot.position.set(x, BOTTOM + h / 2, 0);
    const content = new THREE.Group();
    const idle = new THREE.Group();
    slot.add(content);
    content.add(idle);

    const boardMaterial = new THREE.MeshStandardMaterial({ color: palette.cover, roughness: 0.74, metalness: 0 });
    const pageGeo = new RoundedBoxGeometry(w - 0.07, h - 0.09, Math.max(0.06, t - 0.05), 2, 0.012);
    const boardGeo = new RoundedBoxGeometry(w, h, 0.03, 2, 0.012);
    const spineGeo = new RoundedBoxGeometry(0.05, h, t + 0.01, 2, 0.016);
    const faceGeo = new THREE.PlaneGeometry(w - 0.06, h - 0.06);
    const spineFaceGeo = new THREE.PlaneGeometry(Math.max(0.02, t - 0.02), h - 0.03);

    const pages = new THREE.Mesh(pageGeo, this.shared.pageMaterial);
    pages.position.x = 0.014;
    const front = new THREE.Mesh(boardGeo, boardMaterial);
    front.position.z = t / 2 - 0.015;
    const back = new THREE.Mesh(boardGeo, boardMaterial);
    back.position.z = -(t / 2 - 0.015);
    const spine = new THREE.Mesh(spineGeo, boardMaterial);
    spine.position.x = -w / 2 + 0.02;
    for (const m of [pages, front, back, spine]) {
      m.castShadow = true;
      m.receiveShadow = true;
      idle.add(m);
    }

    const artMaterial = () => new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.01 });
    const spineArt = new THREE.Mesh(spineFaceGeo, artMaterial());
    spineArt.rotation.y = -Math.PI / 2;
    spineArt.position.x = -w / 2 - 0.0072;
    spineArt.visible = false;
    const frontArt = new THREE.Mesh(faceGeo, artMaterial());
    frontArt.position.z = t / 2 + 0.002;
    frontArt.visible = false;
    const backArt = new THREE.Mesh(faceGeo, artMaterial());
    backArt.position.z = -t / 2 - 0.002;
    backArt.rotation.y = Math.PI;
    backArt.visible = false;
    for (const m of [spineArt, frontArt, backArt]) {
      m.receiveShadow = true;
      idle.add(m);
    }

    if (volume.hasFile) {
      // A ribbon over the head of the spine: this one can be opened and read.
      const hang = new THREE.Mesh(this.shared.ribbonHang, this.shared.ribbonMaterial);
      hang.rotation.y = -Math.PI / 2;
      hang.position.set(-w / 2 - 0.012, h / 2 + 0.004, t * 0.16);
      const top = new THREE.Mesh(this.shared.ribbonTop, this.shared.ribbonMaterial);
      top.rotation.x = -Math.PI / 2;
      top.position.set(-w / 2 + 0.09, h / 2 + 0.004, t * 0.16);
      hang.castShadow = true;
      idle.add(hang, top);
    }

    const pick = new THREE.Mesh(this.shared.unitBox, this.shared.pickMaterial);
    pick.scale.set(w, h, t + 0.06);
    pick.visible = false;
    pick.userData.bookIndex = index;
    idle.add(pick);
    this.pickTargets.push(pick);

    return {
      volume,
      index,
      x,
      width: w,
      height: h,
      thickness: t,
      palette,
      slot,
      content,
      idle,
      boardMaterial,
      spineArt,
      frontArt,
      backArt,
      pick,
      geometries: [pageGeo, boardGeo, spineGeo, faceGeo, spineFaceGeo],
      pull: 0,
      hover: 0,
      hoverTarget: 0,
      idleAmount: 0,
      spineReady: false,
      facesReady: false,
      coverThumb: null,
      coverFull: null,
      thumbState: volume.art.coverThumb || volume.art.coverImage ? 'idle' : 'done',
      fullState: volume.art.coverImage ? 'idle' : 'done',
      lastNear: 0,
    };
  }

  // ---------- textures ----------

  private texture(canvas: HTMLCanvasElement | HTMLImageElement, anisotropy = 8): THREE.Texture {
    const tex = canvas instanceof HTMLCanvasElement ? new THREE.CanvasTexture(canvas) : new THREE.Texture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(anisotropy, this.renderer.capabilities.getMaxAnisotropy());
    tex.needsUpdate = true;
    return tex;
  }

  private setMap(mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>, tex: THREE.Texture | null) {
    const old = mesh.material.map;
    mesh.material.map = tex;
    mesh.material.needsUpdate = true;
    mesh.visible = !!tex;
    if (old && old !== tex) old.dispose();
  }

  private paintSpineOf(book: RuntimeBook) {
    this.setMap(book.spineArt, this.texture(paintSpine(book.volume.art, book.palette, book.thickness, book.height), 4));
    book.spineReady = true;
  }

  private paintFacesOf(book: RuntimeBook) {
    const aspect = book.height / book.width;
    const front = book.coverFull ?? book.coverThumb ?? paintFront(book.volume.art, book.palette, aspect);
    this.setMap(book.frontArt, this.texture(front));
    this.setMap(book.backArt, this.texture(paintBack(book.volume.art, book.palette, aspect)));
    book.facesReady = true;
  }

  private releaseFaces(book: RuntimeBook) {
    this.setMap(book.frontArt, null);
    this.setMap(book.backArt, null);
    book.facesReady = false;
    // A decoded 600×900 cover is two megabytes; the browser keeps the file,
    // so letting go costs only a quick decode if the reader comes back.
    book.coverFull = null;
    if (book.fullState === 'done' && book.volume.art.coverImage) book.fullState = 'idle';
  }

  private async loadCover(book: RuntimeBook, which: 'thumb' | 'full') {
    const art = book.volume.art;
    const src = which === 'thumb' ? art.coverThumb ?? art.coverImage : art.coverImage;
    if (which === 'thumb') book.thumbState = 'loading';
    else book.fullState = 'loading';
    this.imagesInFlight += 1;
    const img = src ? await loadImage(src) : null;
    this.imagesInFlight -= 1;
    if (this.disposed || !this.books.includes(book)) return;

    if (which === 'thumb') {
      book.thumbState = 'done';
      if (!img) return;
      book.coverThumb = img;
      // The spine and boards take their colours from the real cover.
      book.palette = paletteFromImage(img, book.palette);
      book.boardMaterial.color.set(book.palette.cover);
      this.paintSpineOf(book);
      if (book.facesReady && !book.coverFull) this.setMap(book.frontArt, this.texture(img));
    } else {
      book.fullState = 'done';
      if (!img) return;
      book.coverFull = img;
      if (book.facesReady) this.setMap(book.frontArt, this.texture(img));
    }
    this.invalidate();
  }

  /**
   * Paint what the reader can see and let go of what they can't: every
   * spine eventually (a few per frame, nearest first), full covers only for
   * the handful of books around the one in front.
   */
  private updateTextures(now: number) {
    const focus = this.selected ?? this.activeIndex;
    const byDistance = (a: RuntimeBook, b: RuntimeBook) => Math.abs(a.index - focus) - Math.abs(b.index - focus);
    let painted = 0;
    const budget = this.ready ? 3 : 10;
    for (const book of this.books.filter((b) => !b.spineReady).sort(byDistance)) {
      if (painted >= budget) break;
      this.paintSpineOf(book);
      painted += 1;
    }

    for (const book of this.books) {
      const near = Math.abs(book.index - focus) <= 2 || book.pull > 0.01 || book.index === this.selected;
      if (near) {
        book.lastNear = now;
        if (book.fullState === 'idle' && this.imagesInFlight < 8) void this.loadCover(book, 'full');
        if (!book.facesReady && painted < budget + 2) {
          this.paintFacesOf(book);
          painted += 1;
        }
      } else if (book.facesReady && now - book.lastNear > 8000 && Math.abs(book.index - focus) > 6) {
        this.releaseFaces(book);
      }
    }

    // Small covers for everyone, nearest first, a few at a time.
    if (this.imagesInFlight < 6) {
      const waiting = this.books.filter((b) => b.thumbState === 'idle').sort(byDistance);
      for (const book of waiting.slice(0, 6 - this.imagesInFlight)) void this.loadCover(book, 'thumb');
    }
    if (painted) this.invalidate();

    if (!this.ready) {
      // Open on a shelf that already wears its real covers, rather than
      // one that changes colour a second later — unless the network is slow.
      const lo = Math.max(0, focus - 10);
      const hi = Math.min(this.books.length - 1, focus + 10);
      let done = true;
      for (let i = lo; i <= hi; i += 1) {
        const b = this.books[i];
        done = done && b.spineReady && (b.thumbState === 'done' || Math.abs(i - focus) > 6);
      }
      if (done || (now - this.volumesSetAt > 2500 && this.books.slice(lo, hi + 1).every((b) => b.spineReady))) {
        this.ready = true;
        this.callbacks.onReady();
      }
    }
  }

  // ---------- motion ----------

  private poseFor(book: RuntimeBook, pull: number) {
    const shelved = SPINE_Z - book.width / 2 + 0.1 * book.hover * (1 - Math.min(1, pull * 8));
    if (pull <= SLIDE_END) {
      const k = smooth(pull / SLIDE_END);
      return { z: shelved + (this.laneZ - shelved) * k, yaw: Math.PI / 2, scale: 1 };
    }
    if (pull <= TURN_END) {
      const k = smooth((pull - SLIDE_END) / (TURN_END - SLIDE_END));
      return { z: this.laneZ, yaw: (Math.PI / 2) * (1 - k), scale: 1 };
    }
    const k = smooth((pull - TURN_END) / (1 - TURN_END));
    return { z: this.laneZ + (this.presentZ - this.laneZ) * k, yaw: 0, scale: 1 + 0.035 * k };
  }

  private applyPose(book: RuntimeBook) {
    const pose = this.poseFor(book, book.pull);
    let z = pose.z;
    let scale = pose.scale;
    if (book.index === this.selected) {
      const e = this.mode === 'returning' ? smooth(this.focusT) : easeOut(this.focusT);
      z += 0.55 * e;
      scale *= 1 + 0.05 * e;
      book.content.position.y = 0.04 * e;
    } else {
      book.content.position.y = 0;
    }
    book.content.position.z = z;
    book.content.rotation.y = pose.yaw;
    book.content.scale.setScalar(scale);
  }

  private xAt(index: number): number {
    if (!this.books.length) return 0;
    const i = Math.floor(clamp(index, 0, this.books.length - 1));
    const j = Math.min(this.books.length - 1, i + 1);
    return THREE.MathUtils.lerp(this.books[i].x, this.books[j].x, clamp(index, 0, this.books.length - 1) - i);
  }

  private update(dt: number, now: number): boolean {
    let moving = false;
    const n = this.books.length;

    if (this.mode === 'browse') {
      if (!this.pointerDown && now - this.lastInput > 140) {
        const snapped = Math.round(this.scrollTarget);
        if (Math.abs(snapped - this.scrollTarget) > 1e-4) {
          this.scrollTarget = damp(this.scrollTarget, snapped, this.reducedMotion ? 20 : 9, dt);
          if (Math.abs(snapped - this.scrollTarget) < 1e-3) this.scrollTarget = snapped;
          moving = true;
        }
      }
      const before = this.scroll;
      this.scroll = damp(this.scroll, this.scrollTarget, this.reducedMotion ? 22 : 10, dt);
      if (Math.abs(this.scroll - this.scrollTarget) < 1e-4) this.scroll = this.scrollTarget;
      if (this.scroll !== before) moving = true;

      const settled = !this.pointerDown && Math.abs(this.scroll - this.scrollTarget) < 0.25 && Math.abs(this.scrollTarget - Math.round(this.scrollTarget)) < 0.02;
      this.presentTarget = settled && n ? clamp(Math.round(this.scrollTarget), 0, n - 1) : null;
    }

    const index = n ? clamp(Math.round(this.scroll), 0, n - 1) : 0;
    if (index !== this.activeIndex && this.mode === 'browse') {
      this.activeIndex = index;
      this.callbacks.onActive(index);
    }
    this.shelfGroup.position.x = -this.xAt(this.scroll);

    // Draw the target book out; everything else goes home. Only one book
    // may be past the slide stage at once, so two never turn into each other.
    const speedOut = this.reducedMotion ? 6 : 1 / 0.58;
    const speedIn = this.reducedMotion ? 7 : 1 / 0.46;
    const target = this.mode === 'browse' ? this.presentTarget : this.selected;
    const othersOut = this.books.some((b) => b.index !== target && b.pull > SLIDE_END + 1e-3);
    for (const book of this.books) {
      const prev = book.pull;
      if (book.index === target) {
        const cap = othersOut ? Math.min(SLIDE_END, 1) : 1;
        book.pull = prev > cap ? Math.max(cap, prev - speedIn * dt) : Math.min(cap, prev + speedOut * dt);
      } else if (book.pull > 0) {
        book.pull = Math.max(0, prev - speedIn * dt);
      }
      const hoverBefore = book.hover;
      book.hover = damp(book.hover, book.hoverTarget, 12, dt);
      if (Math.abs(book.hover - book.hoverTarget) < 1e-3) book.hover = book.hoverTarget;
      if (book.pull !== prev || book.hover !== hoverBefore) moving = true;
    }

    // Focus: the camera comes in and the rest of the room steps back.
    if (this.mode === 'browse' && this.pendingFocus !== null) {
      const book = this.books[this.pendingFocus];
      if (book && book.pull >= 1 && this.presentTarget === this.pendingFocus) this.beginFocus(this.pendingFocus);
    }
    if (this.mode === 'focusing') {
      this.focusT = clamp(this.focusT + dt / (this.reducedMotion ? 0.08 : 0.5), 0, 1);
      moving = true;
      if (this.focusT >= 1) {
        this.setMode('inspect');
        this.controls.enabled = true;
        this.controls.target.copy(this.focusTarget);
        this.controls.minDistance = this.focusDistance * 0.5;
        this.controls.maxDistance = this.focusDistance * 1.45;
      }
    } else if (this.mode === 'returning') {
      this.focusT = clamp(this.focusT - dt / (this.reducedMotion ? 0.08 : 0.38), 0, 1);
      moving = true;
      if (this.focusT <= 0) {
        this.selected = null;
        this.setOffset(0, this.browseOffsetY());
        this.setMode('browse');
        this.canvas.focus({ preventScroll: true });
      }
    }

    const e = this.mode === 'returning' ? smooth(this.focusT) : easeOut(this.focusT);
    const hideRoom = this.selected !== null && e > 0.6;
    this.furniture.visible = !hideRoom;

    for (const book of this.books) {
      const isSel = book.index === this.selected;
      book.content.visible = !hideRoom || isSel;
      const idleTarget = isSel && this.mode === 'inspect' && !this.reducedMotion ? 1 : 0;
      book.idleAmount = damp(book.idleAmount, idleTarget, 4, dt);
      if (book.idleAmount > 1e-3) {
        const t = now / 1000;
        book.idle.position.y = 0.014 * Math.sin(t * 0.8) * book.idleAmount;
        book.idle.rotation.set(
          Math.sin(t * 0.6 + 0.8) * 0.006 * book.idleAmount,
          Math.sin(t * 0.47) * 0.012 * book.idleAmount,
          Math.sin(t * 0.7 + 1.7) * 0.004 * book.idleAmount
        );
        moving = true;
      } else if (book.idle.position.y !== 0) {
        book.idle.position.y = 0;
        book.idle.rotation.set(0, 0, 0);
      }
      this.applyPose(book);
    }

    this.updateCamera(dt, e);
    if (this.controls.enabled) this.controls.update();
    return moving;
  }

  private frameSelected(e: number) {
    if (this.selected === null) return;
    const book = this.books[this.selected];
    const pos = new THREE.Vector3();
    book.content.getWorldPosition(pos);
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    const area = this.callbacks.focusArea();
    const aw = Math.max(80, area.right - area.left);
    const ah = Math.max(80, area.bottom - area.top);
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);

    // Far enough back that the book fills most of the free area, both ways.
    const byHeight = (book.height * 1.12) / (0.84 * (ah / h) * 2 * tanV);
    const byWidth = (book.width * 1.3) / ((aw / w) * 2 * tanV * (w / h));
    this.focusDistance = Math.max(byHeight, byWidth);
    this.focusTarget.copy(pos);
    const narrow = w < 760;
    this.focusCamera.set(pos.x + (narrow ? 0 : 0.3), pos.y + 0.1, pos.z + this.focusDistance);

    // Then slide the picture so the book sits in the middle of that area.
    const focusX = w / 2 - (area.left + aw / 2);
    const focusY = h / 2 - (area.top + ah / 2);
    this.setOffset(focusX * e, this.browseOffsetY() * (1 - e) + focusY * e);
  }

  /**
   * On a phone the caption fills the lower half, so the shelf is framed in
   * the band between the header and the caption rather than dead centre.
   */
  private browseOffsetY(): number {
    const h = this.canvas.clientHeight;
    if (this.canvas.clientWidth >= 760) return 0;
    if (!this.browseBand) return Math.round(h * 0.15);
    // Where the middle of the books lands with no offset, then slide the
    // picture so it lands in the middle of the band instead.
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const distance = this.browseCamera.z - LOOK_AT.z;
    const middle = BOTTOM + this.tallest / 2 - 0.05;
    const shelfY = h / 2 - ((middle - LOOK_AT.y) / (2 * distance * tanV)) * h;
    return Math.round(shelfY - (this.browseBand.top + this.browseBand.bottom) / 2);
  }

  /** The page reports the free band on phones; the shelf reframes to fit it. */
  setBrowseArea(top: number, bottom: number) {
    const prev = this.browseBand;
    // Small shifts (a font settling, a toolbar) are not worth moving the camera for.
    if (prev && Math.abs(prev.top - top) < 12 && Math.abs(prev.bottom - bottom) < 12) return;
    this.browseBand = { top, bottom };
    // The first report frames the shelf at once; later ones glide there
    // (updateCamera eases both the distance and the offset).
    if (!prev) {
      this.framedWidth = 0;
      this.handleResize();
    } else {
      this.browseCamera.z = this.browseDistance(this.canvas.clientWidth, this.canvas.clientHeight);
      this.invalidate();
    }
  }

  private browseDistance(w: number, h: number): number {
    if (w >= 760) return 6.9;
    if (!this.browseBand) return 8.4;
    // Far enough back that the tallest book and the plank fit the band.
    const band = Math.max(120, this.browseBand.bottom - this.browseBand.top);
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    return Math.max(8.4, ((this.tallest + 0.45) * Math.max(1, h)) / (2 * tanV * band) + LOOK_AT.z);
  }

  private setOffset(x: number, y: number) {
    this.viewOffsetY = y;
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) this.camera.clearViewOffset();
    else this.camera.setViewOffset(w, h, x, y, w, h);
  }

  private updateCamera(dt: number, e: number) {
    if (this.mode === 'browse') {
      if (this.camera.position.distanceToSquared(this.browseCamera) > 1e-6) {
        this.camera.position.lerp(this.browseCamera, 1 - Math.exp(-(this.reducedMotion ? 20 : 8) * dt));
        this.camera.lookAt(LOOK_AT);
        this.needsRender = true;
      }
      if (this.focusT < 0.01) {
        const goal = this.browseOffsetY();
        const gap = goal - this.viewOffsetY;
        if (Math.abs(gap) > 0.5) {
          this.setOffset(0, Math.abs(gap) < 1 ? goal : damp(this.viewOffsetY, goal, this.reducedMotion ? 30 : 8, dt));
          this.needsRender = true;
        }
      }
      return;
    }
    if (this.mode === 'focusing') {
      this.frameSelected(e);
      this.camera.position.lerp(this.focusCamera, 1 - Math.exp(-(this.reducedMotion ? 30 : 11) * dt));
      const look = new THREE.Vector3().lerpVectors(LOOK_AT, this.focusTarget, e);
      this.camera.lookAt(look);
    } else if (this.mode === 'returning') {
      this.controls.enabled = false;
      this.frameSelected(e);
      this.camera.position.lerp(this.browseCamera, 1 - Math.exp(-(this.reducedMotion ? 30 : 13) * dt));
      const look = new THREE.Vector3().lerpVectors(LOOK_AT, this.focusTarget, e);
      this.camera.lookAt(look);
    }
  }

  private beginFocus(index: number) {
    this.pendingFocus = null;
    this.selected = index;
    this.focusT = 0;
    this.books.forEach((b) => (b.hoverTarget = 0));
    this.frameSelected(0);
    this.setMode('focusing');
  }

  private setMode(mode: SceneMode) {
    this.mode = mode;
    this.callbacks.onMode(mode);
    this.invalidate();
  }

  // ---------- public controls ----------

  /**
   * Swap one book's printing — a corrected title, a new cover — without
   * rebuilding the shelf, so a reader editing the book they're holding up
   * keeps holding it.
   */
  updateVolume(index: number, volume: SceneVolume) {
    const book = this.books[index];
    if (!book) return;
    book.volume = volume;
    book.palette = paletteFor(volume.art.seed);
    book.boardMaterial.color.set(book.palette.cover);
    book.coverThumb = null;
    book.coverFull = null;
    book.thumbState = volume.art.coverThumb || volume.art.coverImage ? 'idle' : 'done';
    book.fullState = volume.art.coverImage ? 'idle' : 'done';
    this.paintSpineOf(book);
    if (book.facesReady) this.paintFacesOf(book);
    this.invalidate();
  }


  browseBy(delta: number) {
    if (this.mode !== 'browse') return;
    this.browseTo(Math.round(this.scrollTarget) + delta);
  }

  browseTo(index: number, instant = false) {
    if (this.mode !== 'browse' || !this.books.length) return;
    this.pendingFocus = null;
    this.scrollTarget = clamp(Math.round(index), 0, this.books.length - 1);
    if (instant) this.scroll = this.scrollTarget;
    this.lastInput = performance.now() - 1000;
    this.invalidate();
  }

  focus(index: number = this.activeIndex) {
    if (this.mode !== 'browse' || !this.books.length) return;
    const i = clamp(Math.round(index), 0, this.books.length - 1);
    this.scrollTarget = i;
    this.lastInput = performance.now() - 1000;
    this.pendingFocus = i;
    this.invalidate();
  }

  returnToShelf() {
    if (this.mode === 'browse') {
      this.pendingFocus = null;
      return;
    }
    if (this.mode === 'returning') return;
    this.controls.enabled = false;
    this.setMode('returning');
  }

  resetView() {
    if (this.mode !== 'inspect') return;
    this.frameSelected(1);
    this.camera.position.copy(this.focusCamera);
    this.controls.target.copy(this.focusTarget);
    this.controls.update();
    this.invalidate();
  }

  // ---------- input ----------

  private invalidate = () => {
    this.needsRender = true;
  };

  private updatePointer(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  private raycastBook(): number | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.pickTargets, false)[0];
    const i = hit?.object.userData.bookIndex;
    return typeof i === 'number' ? i : null;
  }

  private handleWheel = (e: WheelEvent) => {
    if (this.mode !== 'browse') return;
    e.preventDefault();
    this.pendingFocus = null;
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    const unit = e.deltaMode === 1 ? 16 : 1;
    this.scrollTarget = clamp(this.scrollTarget + d * unit * 0.0026, 0, Math.max(0, this.books.length - 1));
    this.lastInput = performance.now();
    this.invalidate();
  };

  private handlePointerDown = (e: PointerEvent) => {
    if (this.mode !== 'browse') return;
    this.pointerDown = true;
    this.pointerId = e.pointerId;
    this.pointerStartX = this.pointerLastX = e.clientX;
    this.pointerTravel = 0;
    this.canvas.setPointerCapture(e.pointerId);
  };

  private handlePointerMove = (e: PointerEvent) => {
    this.updatePointer(e);
    if (this.mode !== 'browse') return;
    if (this.pointerDown && e.pointerId === this.pointerId) {
      this.pendingFocus = null;
      const dx = e.clientX - this.pointerLastX;
      this.pointerLastX = e.clientX;
      this.pointerTravel += Math.abs(dx);
      const perBook = Math.max(70, 0.085 * this.canvas.clientWidth);
      this.scrollTarget = clamp(this.scrollTarget - dx / perBook, 0, Math.max(0, this.books.length - 1));
      this.lastInput = performance.now();
      if (this.pointerTravel > 6) this.canvas.classList.add('is-dragging');
      this.invalidate();
      return;
    }
    if (e.pointerType === 'mouse') {
      this.hoverDirty = true;
      this.lampFollowsPointer = true;
      this.invalidate();
    }
  };

  private handlePointerUp = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    const tap = this.pointerTravel < 7 && Math.abs(e.clientX - this.pointerStartX) < 7;
    this.pointerDown = false;
    this.pointerId = null;
    this.canvas.classList.remove('is-dragging');
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (this.mode === 'browse' && tap) {
      this.updatePointer(e);
      const hit = this.raycastBook();
      if (hit === null) return;
      if (hit === Math.round(this.scrollTarget)) this.focus(hit);
      else this.browseTo(hit);
    }
  };

  private handlePointerCancel = () => {
    this.pointerDown = false;
    this.pointerId = null;
    this.canvas.classList.remove('is-dragging');
  };

  private handlePointerLeave = () => {
    this.lampFollowsPointer = false;
    this.invalidate();
    if (this.pointerDown) return;
    this.books.forEach((b) => (b.hoverTarget = 0));
    this.canvas.style.cursor = '';
  };

  private updateHover() {
    this.hoverDirty = false;
    if (this.mode !== 'browse' || this.pointerDown) return;
    const hit = this.raycastBook();
    this.books.forEach((b) => (b.hoverTarget = b.index === hit && b.pull < 0.01 ? 1 : 0));
    this.canvas.style.cursor = hit === null ? '' : 'pointer';
    this.invalidate();
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      this.returnToShelf();
      return;
    }
    if ((e.key === 'r' || e.key === 'R') && this.mode === 'inspect') {
      this.resetView();
      return;
    }
    if (this.mode !== 'browse') return;
    const map: Record<string, () => void> = {
      ArrowRight: () => this.browseBy(1),
      ArrowLeft: () => this.browseBy(-1),
      Home: () => this.browseTo(0),
      End: () => this.browseTo(this.books.length - 1),
      Enter: () => this.focus(this.activeIndex),
      ' ': () => this.focus(this.activeIndex),
    };
    const action = map[e.key];
    if (action) {
      e.preventDefault();
      action();
    }
  };

  private handleResize = () => {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    const narrow = w < 760;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, narrow ? 1.5 : 1.75));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w < 600 ? 33 : w < 920 ? 30 : 27;
    this.camera.updateProjectionMatrix();
    this.browseCamera.set(0, narrow ? 1.5 : 1.46, this.browseDistance(w, h));
    // A new width (a rotation, a desktop window) reframes at once. A new
    // height alone is a phone toolbar sliding in or out: glide instead.
    const snap = w !== this.framedWidth;
    this.framedWidth = w;
    if (this.mode === 'browse' && this.focusT < 0.01) {
      if (snap) {
        this.setOffset(0, this.browseOffsetY());
        this.camera.position.copy(this.browseCamera);
        this.camera.lookAt(LOOK_AT);
      } else {
        // Same offset at the new size; updateCamera eases the rest.
        this.setOffset(0, this.viewOffsetY);
      }
    } else if (this.mode === 'inspect') {
      this.frameSelected(1);
    }
    this.invalidate();
  };

  private handleContextLost = (e: Event) => {
    e.preventDefault();
    this.callbacks.onContextLost();
  };

  private updateLamp(dt: number): boolean {
    const goal = this.lampGoal;
    let onPointer = false;
    if (this.lampFollowsPointer && this.mode === 'browse' && !this.pointerDown) {
      this.raycaster.setFromCamera(this.pointer, this.camera);
      onPointer = this.raycaster.ray.intersectPlane(this.lampPlane, goal) !== null;
    }
    if (!onPointer) {
      const book = this.books[this.activeIndex];
      if (!book) return false;
      book.content.getWorldPosition(goal);
      goal.y += book.height * 0.55;
    }
    goal.y = clamp(goal.y, 0.6, 2.6);
    if (Number.isNaN(this.lampAim.x)) this.lampAim.copy(goal);
    const dx = goal.x - this.lampAim.x, dy = goal.y - this.lampAim.y, dz = goal.z - this.lampAim.z;
    const moving = dx * dx + dy * dy + dz * dz > 1e-6;
    this.lampAim.lerp(goal, moving ? 1 - Math.exp(-(this.reducedMotion ? 40 : 7) * dt) : 1);
    this.lamp.position.set(this.lampAim.x - 0.4, this.lampAim.y + 3.2, this.lampAim.z + 2.8);
    this.lamp.target.position.copy(this.lampAim);
    this.lamp.target.updateMatrixWorld();
    // The same pool of light, drawn by the page on the wall behind the books.
    this.lampScreen.copy(this.lampAim).project(this.camera);
    const room = this.canvas.parentElement;
    if (room) {
      room.style.setProperty('--lamp-x', `${(((this.lampScreen.x + 1) / 2) * 100).toFixed(1)}%`);
      room.style.setProperty('--lamp-y', `${(((1 - this.lampScreen.y) / 2) * 100).toFixed(1)}%`);
    }
    return moving;
  }

  private animate = (time: number) => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.animate);
    const dt = clamp((time - this.lastTime) / 1000 || 1 / 60, 0, 0.05);
    this.lastTime = time;
    if (this.hoverDirty) this.updateHover();
    const moving = this.update(dt, time);
    const lampMoving = this.updateLamp(dt);
    this.updateTextures(time);
    // Nothing moving, nothing to draw: a still shelf costs no battery.
    if (moving || lampMoving || this.needsRender || this.controls.enabled) {
      this.renderer.render(this.scene, this.camera);
      this.needsRender = false;
    }
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.controls.removeEventListener('change', this.invalidate);
    this.controls.dispose();
    const c = this.canvas;
    c.removeEventListener('webglcontextlost', this.handleContextLost);
    c.removeEventListener('wheel', this.handleWheel);
    c.removeEventListener('pointerdown', this.handlePointerDown);
    c.removeEventListener('pointermove', this.handlePointerMove);
    c.removeEventListener('pointerup', this.handlePointerUp);
    c.removeEventListener('pointercancel', this.handlePointerCancel);
    c.removeEventListener('pointerleave', this.handlePointerLeave);
    c.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('blur', this.handlePointerCancel);
    this.disposeBooks();
    this.clearFurniture();
    this.furnitureGeometries.forEach((g) => g.dispose());
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) (mesh.material as THREE.Material)?.dispose();
    });
    this.woodTexture?.dispose();
    Object.values(this.shared).forEach((s) => s.dispose());
    this.renderer.dispose();
  }
}
