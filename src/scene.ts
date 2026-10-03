import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MotionTrack, PlaybackClock } from './motion';
import { groundMeshes } from './surfaces';
import { extraBuildings, instanceScenery, prepareModel, sceneryPlan, type Placement } from './scenery';
import { CityObjects } from './city-objects';
import { moveVisitor, nearestWalkable, type Agent, type Bounds, type CityObject, type Portal, type Position, type Space, type StaticWorld, type WorldState } from './world';

export type FocusTarget = { kind: 'agent'; id: string; name: string } | { kind: 'portal'; portal: Portal; name: string } | { kind: 'object'; object: CityObject; name: string };
export interface SceneCallbacks {
  position: (position: Position, heading: number) => void;
  focus: (target: FocusTarget | null) => void;
  interact: (target: FocusTarget) => void;
  locked: (locked: boolean) => void;
  error: (message: string) => void;
  assets: (loading: number, failed: number) => void;
}

const buildingModels: Record<string, string> = {
  'iog-house': 'campus', 'shielded-house': 'shielded', 'midnight-house': 'foundation',
  'charging-house': 'charging', 'ada-arena': 'arena', prison: 'police',
  'central-workshops': 'workshop', 'always-good-times': 'urban-diner',
  'hacker-house': 'hacker', 'pet-shop': 'urban-shop', nexifuse: 'clinic',
};

function movementKey(event: KeyboardEvent) {
  if (event.code) return event.code;
  const letter = event.key.toLowerCase();
  if (['w', 'a', 's', 'd', 'e'].includes(letter)) return `Key${letter.toUpperCase()}`;
  return event.key === 'Shift' ? 'ShiftLeft' : event.key;
}

export function blockedRectangle(world: StaticWorld, space: Space, bounds: Bounds): Bounds | null {
  const minX = Math.max(0, bounds.minX), maxX = Math.min(space.width - 1, bounds.maxX);
  const heights = Array<number>(maxX - minX + 1).fill(0);
  let best: Bounds | null = null, bestArea = 0;
  for (let row = Math.max(0, bounds.minY); row <= Math.min(space.height - 1, bounds.maxY); row++) {
    for (let column = minX; column <= maxX; column++) {
      const cell = world.cells[`${space.id},${column},${row}`];
      heights[column - minX] = cell?.traversability === 'blocked' && cell.terrain !== 'water' ? heights[column - minX] + 1 : 0;
    }
    for (let left = 0; left < heights.length; left++) {
      let height = Infinity;
      for (let right = left; right < heights.length; right++) {
        height = Math.min(height, heights[right]);
        if (height < 2) break;
        const area = height * (right - left + 1);
        if (right - left >= 1 && area > bestArea) {
          bestArea = area; best = { minX: left + minX, maxX: right + minX, minY: row - height + 1, maxY: row };
        }
      }
    }
  }
  return best;
}

export class CityScene {
  private renderer: THREE.WebGLRenderer;
  private environment: THREE.WebGLRenderTarget;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(72, 1, 0.08, 260);
  private controls: PointerLockControls;
  private stage = new THREE.Group();
  private residents = new Map<string, { object: THREE.Group; motion: MotionTrack; agent: Agent; label: THREE.Sprite; color: THREE.Color; stride: number; heading: number }>();
  private playback = new PlaybackClock();
  private cityObjects = new CityObjects();
  private world?: WorldState;
  private space?: Space;
  private renderedVersion?: string;
  private keys = new Set<string>();
  private unsampledKeys = new Set<string>();
  private tappedKeys = new Set<string>();
  private target: FocusTarget | null = null;
  private position: Position = { spaceId: 'central', x: 72, y: 65 };
  private observer: ResizeObserver;
  private modelCache = new Map<string, Promise<THREE.Group>>();
  private landmarks: { model: string; bounds: Bounds; height: number; fallback: THREE.Mesh }[] = [];
  private sceneryCount = 0;
  private loader = new GLTFLoader();
  private disposed = false;
  private generation = 0;
  private loading = 0;
  private failed = 0;
  private previousTime = 0;
  private lastHud = 0;
  private diagnosticFrames: number[] = [];
  private diagnosticAt = 0;
  private diagnostics = new URLSearchParams(location.search).has('diagnostics');
  private forward = new THREE.Vector3();
  private right = new THREE.Vector3();
  private aim = new THREE.Vector3();
  private sightHeights = new Float32Array();
  private direction = new THREE.Vector3();
  private instance = new THREE.Object3D();
  private crowdBodies: THREE.InstancedMesh;
  private crowdHeads: THREE.InstancedMesh;
  private crowdLegs: THREE.InstancedMesh;
  private lastPosition = new THREE.Vector3(Infinity, Infinity, Infinity);
  private bodyGeometry = new THREE.CapsuleGeometry(0.21, 0.78, 3, 6);
  private headGeometry = new THREE.SphereGeometry(0.18, 8, 6);

  constructor(private container: HTMLElement, private callbacks: SceneCallbacks) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    const environmentGenerator = new THREE.PMREMGenerator(this.renderer);
    const environmentRoom = new RoomEnvironment();
    this.environment = environmentGenerator.fromScene(environmentRoom, 0.04);
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = 0.2;
    environmentRoom.dispose(); environmentGenerator.dispose();
    this.renderer.domElement.setAttribute('aria-label', 'First-person Midnight City world');
    this.renderer.domElement.tabIndex = 0;
    container.append(this.renderer.domElement);
    this.scene.background = new THREE.Color('#101b2b');
    this.scene.fog = new THREE.Fog('#101b2b', 50, 170);
    this.scene.add(new THREE.HemisphereLight('#cadfff', '#514e49', 1.4));
    const moon = new THREE.DirectionalLight('#dce9ff', 1.2);
    moon.position.set(60, 90, 30);
    this.scene.add(moon, this.stage, this.cityObjects.root);
    this.crowdBodies = new THREE.InstancedMesh(this.bodyGeometry, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85 }), 2048);
    this.crowdHeads = new THREE.InstancedMesh(this.headGeometry, new THREE.MeshStandardMaterial({ color: '#c3a98b', roughness: 0.9 }), 2048);
    this.crowdLegs = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.075, 0.08, 0.4, 6), new THREE.MeshStandardMaterial({ color: '#283043', roughness: 0.9 }), 4096);
    for (const mesh of [this.crowdBodies, this.crowdHeads, this.crowdLegs]) {
      mesh.count = 0; mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.scene.add(mesh);
    }
    this.controls = new PointerLockControls(this.camera, this.renderer.domElement);
    this.controls.pointerSpeed = 0.7;
    this.controls.addEventListener('lock', this.onLock);
    this.controls.addEventListener('unlock', this.onUnlock);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    window.addEventListener('blur', this.clearKeys);
    document.addEventListener('visibilitychange', this.visibility);
    document.addEventListener('pointerlockerror', this.pointerError);
    this.renderer.domElement.addEventListener('click', this.canvasClick);
    this.renderer.domElement.addEventListener('webglcontextlost', this.contextLost);
    this.renderer.setAnimationLoop(this.frame);
    this.resize();
  }

  private onLock = () => this.callbacks.locked(true);
  private onUnlock = () => { this.clearKeys(); this.callbacks.locked(false); };
  private clearKeys = () => { this.keys.clear(); this.unsampledKeys.clear(); this.tappedKeys.clear(); };
  private visibility = () => { if (document.hidden) this.unlock(); };
  private pointerError = () => this.callbacks.error('Mouse capture was unavailable. Click Walk again, or focus the world and use WASD + arrow keys.');
  private contextLost = (event: Event) => { event.preventDefault(); this.unlock(); this.callbacks.error('Graphics context lost. Reload this page to restore the world.'); this.renderer.setAnimationLoop(null); };
  private canvasClick = () => { if (this.controls.isLocked) this.interact(); else this.lock(); };
  private keyDown = (event: KeyboardEvent) => {
    if (event.target instanceof Element && event.target.closest('input, textarea, select, button, a, [role="dialog"], [contenteditable]')) return;
    if (!this.controls.isLocked && document.activeElement !== this.renderer.domElement) return;
    if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
    const key = movementKey(event);
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyE'].includes(key)) {
      event.preventDefault();
      if (key === 'KeyE' && !event.repeat) this.interact();
      else { if (!this.keys.has(key)) this.unsampledKeys.add(key); this.keys.add(key); }
    }
  };
  private keyUp = (event: KeyboardEvent) => {
    const key = movementKey(event);
    if (this.unsampledKeys.has(key)) this.tappedKeys.add(key);
    this.unsampledKeys.delete(key); this.keys.delete(key);
  };

  lock() { if (!this.space) return; this.renderer.domElement.focus(); this.controls.lock(); }
  unlock() { this.controls.unlock(); this.clearKeys(); }
  interact() { if (this.target) { this.unlock(); this.callbacks.interact(this.target); } }

  update(world: WorldState) {
    this.world = world;
    this.playback.observe(world.dynamicWorld.timestamp, performance.now(), world.dynamicWorld.tickRateMs);
    if (!this.space) return;
    this.cityObjects.update(world, this.space.id);
    const present = new Set<string>();
    for (const agent of world.dynamicWorld.agents) {
      if (agent.position.spaceId !== this.space.id) continue;
      present.add(agent.id);
      let resident = this.residents.get(agent.id);
      if (!resident) {
        const object = new THREE.Group();
        const label = this.label(agent.name, '#f1f5f9', 2.6);
        label.position.y = 2.03; object.add(label);
        const hash = [...agent.id].reduce((value, letter) => (value * 31 + letter.charCodeAt(0)) >>> 0, 0);
        object.position.set(agent.position.x + 0.5, 0, agent.position.y + 0.5);
        resident = { object, motion: new MotionTrack(), agent, label, color: new THREE.Color().setHSL((hash % 360) / 360, 0.4, 0.36), stride: 0, heading: 0 };
        this.residents.set(agent.id, resident);
        this.scene.add(object);
      }
      resident.motion.push(agent.position, world.dynamicWorld.timestamp);
      resident.agent = agent;
    }
    for (const [id, resident] of this.residents) if (!present.has(id)) {
      this.scene.remove(resident.object); this.disposeObject(resident.object); this.residents.delete(id);
    }
  }

  visit(spaceId: string, requested?: Position) {
    if (!this.world) return;
    const space = this.world.staticWorld.spaces.find(candidate => candidate.id === spaceId);
    if (!space) return;
    if (space.id !== this.space?.id || this.renderedVersion !== this.world.staticVersion) {
      this.generation++;
      this.scene.remove(this.stage);
      this.disposeObject(this.stage);
      this.stage = new THREE.Group();
      this.sightHeights = new Float32Array(space.width * space.height);
      this.scene.add(this.stage);
      this.space = space;
      this.renderedVersion = this.world.staticVersion;
      this.failed = 0;
      this.landmarks = [];
      this.buildTerrain(this.world.staticWorld, space);
      this.update(this.world);
    }
    const plaza = this.world.staticWorld.areas.find(area => area.spaceId === space.id && area.id === 'central-plaza');
    this.position = nearestWalkable(this.world.staticWorld, space, requested ?? plaza?.anchor ?? space.entry);
    this.camera.position.set(this.position.x, 1.65, this.position.y);
    this.camera.rotation.set(0, 0, 0);
    this.clearKeys(); this.target = null;
    this.callbacks.position(this.position, 0); this.callbacks.focus(null);
  }

  private label(text: string, color = '#c5e7a1', width = 3.5) {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 96;
    const context = canvas.getContext('2d')!;
    context.fillStyle = 'rgba(9,15,22,0.9)'; context.fillRect(0, 0, 512, 96);
    context.font = '500 34px system-ui'; context.fillStyle = color; context.textAlign = 'center';
    context.fillText(text.length > 30 ? text.slice(0, 27) + '…' : text, 256, 60, 480);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: true, transparent: true }));
    label.scale.set(width, width * 96 / 512, 1);
    return label;
  }

  private buildTerrain(world: StaticWorld, space: Space) {
    this.stage.add(...groundMeshes(world, space));
    const covered = new Set<string>();
    const landmarks = world.areas.filter(area => area.spaceId === space.id && area.bounds && !/bridge|entrance|door/.test(area.id) && (area.kind === 'inn' || area.kind === 'building' || area.id === 'nexifuse'));
    for (const area of landmarks) {
      const bounds = blockedRectangle(world, space, area.bounds!);
      if (!bounds) continue;
      const model = space.kind === 'interior' ? undefined : buildingModels[area.id] ?? 'urban-house';
      this.buildLandmark(bounds, area.name, model, covered);
    }
    if (space.id === 'central') {
      const plaza = world.areas.find(area => area.id === 'central-plaza');
      if (plaza?.anchor && plaza.bounds) {
        const center = plaza.anchor.x + 1;
        const bounds = blockedRectangle(world, space, { minX: center - 10, maxX: center + 9, minY: plaza.bounds.minY - 7, maxY: plaza.bounds.minY + 3 });
        if (bounds) this.buildLandmark(bounds, 'City Hall', 'city-hall', covered);
      }
    }
    for (const building of extraBuildings(space)) {
      const bounds = blockedRectangle(world, space, building.bounds);
      if (!bounds) continue;
      let overlaps = false;
      for (let row = bounds.minY; row <= bounds.maxY; row++) for (let column = bounds.minX; column <= bounds.maxX; column++) if (covered.has(`${column},${row}`)) overlaps = true;
      if (!overlaps) this.buildLandmark(bounds, '', building.model, covered);
    }
    const obstacles: { horizontal: number; depth: number; height: number }[] = [];
    for (let row = 0; row < space.height; row++) for (let column = 0; column < space.width; column++) {
      const cell = world.cells[`${space.id},${column},${row}`];
      if (!cell || cell.traversability !== 'blocked' || cell.terrain === 'water' || covered.has(`${column},${row}`)) continue;
      const edge = column === 0 || row === 0 || column === space.width - 1 || row === space.height - 1;
      obstacles.push({ horizontal: column + 0.5, depth: row + 0.5, height: space.kind === 'interior' ? edge ? 3.2 : 0.85 : edge ? 1.4 : 0.3 });
      this.sightHeights[row * space.width + column] = obstacles.at(-1)!.height;
    }
    if (obstacles.length) {
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.99, 1, 0.99), new THREE.MeshStandardMaterial({ color: space.kind === 'interior' ? '#554e49' : '#344d43', roughness: 0.95 }), obstacles.length);
      const object = new THREE.Object3D();
      obstacles.forEach((obstacle, index) => { object.position.set(obstacle.horizontal, obstacle.height / 2, obstacle.depth); object.scale.set(1, obstacle.height, 1); object.updateMatrix(); mesh.setMatrixAt(index, object.matrix); });
      mesh.computeBoundingSphere(); this.stage.add(mesh);
    }
    for (const portal of world.teleports.filter(portal => portal.spaceId === space.id)) {
      const destination = world.spaces.find(candidate => candidate.id === portal.targetSpaceId);
      if (!destination) continue;
      const horizontal = (portal.bounds.minX + portal.bounds.maxX + 1) / 2;
      const depth = (portal.bounds.minY + portal.bounds.maxY + 1) / 2;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.055, 6, 24), new THREE.MeshBasicMaterial({ color: '#a3e635' }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(horizontal, 0.08, depth);
      const sign = this.label(destination.name); sign.position.set(horizontal, 2.5, depth);
      this.stage.add(ring, sign);
    }
    for (const area of world.areas.filter(area => area.spaceId === space.id && area.anchor && area.kind === 'park')) {
      const sign = this.label(area.name, '#e2e8f0', 4);
      sign.position.set(area.anchor!.x + 0.5, 3.2, area.anchor!.y + 0.5); this.stage.add(sign);
    }
    const props = sceneryPlan(world, space, covered);
    this.sceneryCount = props.length;
    this.buildModels(props);
  }

  private buildLandmark(bounds: Bounds, name: string, model: string | undefined, covered: Set<string>) {
    for (let row = bounds.minY; row <= bounds.maxY; row++) for (let column = bounds.minX; column <= bounds.maxX; column++) covered.add(`${column},${row}`);
    const width = bounds.maxX - bounds.minX + 1, depth = bounds.maxY - bounds.minY + 1;
    const horizontal = bounds.minX + width / 2, vertical = bounds.minY + depth / 2;
    const height = model ? Math.min(12, Math.max(3, width * 0.65)) : 0.85;
    const fallback = new THREE.Mesh(new THREE.BoxGeometry(width * 0.98, height, depth * 0.98), new THREE.MeshStandardMaterial({ color: '#536072', roughness: 0.8 }));
    fallback.position.set(horizontal, height / 2, vertical); this.stage.add(fallback);
    if (this.space) for (let row = bounds.minY; row <= bounds.maxY; row++) for (let column = bounds.minX; column <= bounds.maxX; column++) this.sightHeights[row * this.space.width + column] = height;
    if (model) {
      if (name) { const label = this.label(name, '#e2e8f0', Math.min(7, width)); label.position.set(horizontal, 2.8, bounds.maxY + 1.08); this.stage.add(label); }
      this.landmarks.push({ model, bounds, height, fallback });
    }
  }

  private loadModel(model: string) {
    let pending = this.modelCache.get(model);
    if (!pending) {
      this.loading++; this.callbacks.assets(this.loading, this.failed);
      pending = this.loader.loadAsync(`/city-assets/${model}.glb`).then(asset => {
        const prepared = prepareModel(asset.scene);
        asset.scene.traverse(child => { if (child instanceof THREE.Mesh) child.geometry.dispose(); });
        return prepared;
      }).finally(() => { this.loading--; if (!this.disposed) this.callbacks.assets(this.loading, this.failed); });
      this.modelCache.set(model, pending);
    }
    return pending;
  }

  private buildModels(props: Placement[]) {
    const generation = this.generation;
    const models = new Set([...this.landmarks.map(landmark => landmark.model), ...props.map(prop => prop.model)]);
    const landmarks = this.landmarks;
    for (const model of models) {
      void this.loadModel(model).then(original => {
        if (this.disposed || generation !== this.generation) return;
        const box = new THREE.Box3().setFromObject(original), size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
        const placements = props.filter(prop => prop.model === model);
        for (const landmark of landmarks.filter(landmark => landmark.model === model)) {
          const { bounds, height, fallback } = landmark;
          const width = bounds.maxX - bounds.minX + 1, depth = bounds.maxY - bounds.minY + 1;
          const scaleX = width * 0.97 / Math.max(size.x, 0.01), scaleZ = depth * 0.97 / Math.max(size.z, 0.01);
          const scaleY = Math.min(scaleX, scaleZ, height / Math.max(size.y, 0.01));
          placements.push({ model, x: bounds.minX + width / 2 - center.x * scaleX, z: bounds.minY + depth / 2 - center.z * scaleZ, y: -box.min.y * scaleY, scaleX, scaleY, scaleZ });
          fallback.visible = false;
        }
        this.stage.add(instanceScenery(original, placements));
      }).catch(() => {
        if (!this.disposed && generation === this.generation) { this.failed++; this.callbacks.assets(this.loading, this.failed); }
      });
    }
  }

  private resize() {
    const width = this.container.clientWidth, height = this.container.clientHeight;
    if (!width || !height) return;
    this.renderer.setSize(width, height); this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
  }

  private frame = (time: number) => {
    const frameInterval = time - this.previousTime;
    const delta = Math.min(0.05, Math.max(0, (time - this.previousTime) / 1000)); this.previousTime = time;
    if (document.hidden || this.disposed) return;
    if (this.world && this.space) {
      const activeKeys = new Set([...this.keys, ...this.tappedKeys]);
      this.tappedKeys.clear(); this.unsampledKeys.clear();
      const yaw = Number(activeKeys.has('ArrowLeft')) - Number(activeKeys.has('ArrowRight'));
      const pitch = Number(activeKeys.has('ArrowUp')) - Number(activeKeys.has('ArrowDown'));
      this.camera.rotation.order = 'YXZ'; this.camera.rotation.y += yaw * delta * 1.5;
      this.camera.rotation.x = THREE.MathUtils.clamp(this.camera.rotation.x + pitch * delta, -1.4, 1.4);
      this.camera.getWorldDirection(this.forward); this.forward.y = 0; this.forward.normalize();
      this.right.crossVectors(this.forward, this.camera.up).normalize();
      const forward = Number(activeKeys.has('KeyW')) - Number(activeKeys.has('KeyS'));
      const sideways = Number(activeKeys.has('KeyD')) - Number(activeKeys.has('KeyA'));
      const speed = activeKeys.has('ShiftLeft') || activeKeys.has('ShiftRight') ? 5 : 2.7;
      const distance = speed * delta / Math.max(1, Math.hypot(forward, sideways));
      this.position = moveVisitor(this.world.staticWorld, this.position,
        (this.forward.x * forward + this.right.x * sideways) * distance,
        (this.forward.z * forward + this.right.z * sideways) * distance);
      this.camera.position.set(this.position.x, 1.65, this.position.y);
      const playbackTime = this.playback.read(time);
      this.cityObjects.render(playbackTime);
      let instanceIndex = 0;
      for (const resident of this.residents.values()) {
        const previousX = resident.object.position.x, previousZ = resident.object.position.z;
        resident.motion.write(playbackTime, resident.object.position);
        const movedX = resident.object.position.x - previousX, movedZ = resident.object.position.z - previousZ;
        const moved = Math.hypot(movedX, movedZ);
        if (moved > 0.001 && moved < 1) { resident.heading = Math.atan2(movedX, movedZ); resident.stride += moved * 7; }
        const distance = resident.object.position.distanceTo(this.camera.position);
        const width = Math.min(2.6, distance * 0.32);
        resident.label.scale.set(width, width * 96 / 512, 1);
        resident.label.visible = distance < 18;
        this.instance.rotation.set(0, resident.heading, 0);
        this.instance.position.copy(resident.object.position); this.instance.position.y = 0.85; this.instance.updateMatrix();
        this.crowdBodies.setMatrixAt(instanceIndex, this.instance.matrix); this.crowdBodies.setColorAt(instanceIndex, resident.color);
        this.instance.position.y = 1.55; this.instance.updateMatrix(); this.crowdHeads.setMatrixAt(instanceIndex, this.instance.matrix);
        for (let leg = 0; leg < 2; leg++) {
          const side = leg ? 1 : -1;
          this.instance.position.set(resident.object.position.x + Math.cos(resident.heading) * side * 0.1, 0.22, resident.object.position.z - Math.sin(resident.heading) * side * 0.1);
          this.instance.rotation.x = moved > 0.001 && moved < 1 ? Math.sin(resident.stride) * side * 0.4 : 0;
          this.instance.updateMatrix(); this.crowdLegs.setMatrixAt(instanceIndex * 2 + leg, this.instance.matrix);
        }
        instanceIndex++;
      }
      this.crowdBodies.count = this.crowdHeads.count = instanceIndex;
      this.crowdLegs.count = instanceIndex * 2; this.crowdLegs.instanceMatrix.needsUpdate = true;
      this.crowdBodies.instanceMatrix.needsUpdate = this.crowdHeads.instanceMatrix.needsUpdate = true;
      if (this.crowdBodies.instanceColor) this.crowdBodies.instanceColor.needsUpdate = true;
      if (time - this.lastHud > 120) {
        this.lastHud = time; this.updateFocus();
        if (Math.abs(this.lastPosition.x - this.position.x) > 0.005 || Math.abs(this.lastPosition.z - this.position.y) > 0.005 || Math.abs(this.lastPosition.y - this.camera.rotation.y) > 0.005) {
          this.lastPosition.set(this.position.x, this.camera.rotation.y, this.position.y);
          this.callbacks.position({ ...this.position }, this.camera.rotation.y);
        }
      }
    }
    this.renderer.render(this.scene, this.camera);
    if (this.diagnostics) {
      this.diagnosticFrames.push(frameInterval);
      if (time - this.diagnosticAt > 2000) {
        const frames = this.diagnosticFrames.sort((left, right) => left - right);
        this.renderer.domElement.dataset.performance = JSON.stringify({ fps: +(1000 * frames.length / frames.reduce((sum, frame) => sum + frame, 0)).toFixed(1), p95: frames[Math.floor(frames.length * 0.95)], calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles, geometries: this.renderer.info.memory.geometries, textures: this.renderer.info.memory.textures, residents: this.residents.size, scenery: this.sceneryCount, buildings: this.landmarks.length, objects: this.cityObjects.objects.size, loading: this.loading, failed: this.failed });
        this.diagnosticFrames = []; this.diagnosticAt = time;
      }
    }
  };

  private updateFocus() {
    if (!this.world || !this.space) return;
    this.camera.getWorldDirection(this.aim);
    let target: FocusTarget | null = null, best = 7;
    for (const resident of this.residents.values()) {
      const agent = resident.agent;
      const direction = this.direction.copy(resident.object.position); direction.y = 1.4; direction.sub(this.camera.position);
      const distance = direction.length(); direction.normalize();
      if (distance >= best || this.aim.dot(direction) < 0.93) continue;
      if (!this.hasSight(resident.object.position)) continue;
      best = distance; target = { kind: 'agent', id: agent.id, name: agent.name };
    }
    for (const object of this.cityObjects.objects.values()) {
      const direction = this.direction.copy(object.position); direction.y = 0.9; direction.sub(this.camera.position);
      const distance = direction.length(); direction.normalize();
      if (distance < Math.min(best, 4) && this.aim.dot(direction) > 0.94) {
        best = distance; target = { kind: 'object', object: object.data, name: object.data.name ?? object.data.id?.replaceAll('_', ' ') ?? object.kind };
      }
    }
    for (const portal of this.world.staticWorld.teleports.filter(portal => portal.spaceId === this.space!.id)) {
      const distance = Math.hypot((portal.bounds.minX + portal.bounds.maxX + 1) / 2 - this.position.x, (portal.bounds.minY + portal.bounds.maxY + 1) / 2 - this.position.y);
      if (distance < Math.min(best, 2.5)) {
        const space = this.world.staticWorld.spaces.find(space => space.id === portal.targetSpaceId);
        if (space) { best = distance; target = { kind: 'portal', portal, name: space.name }; }
      }
    }
    if (JSON.stringify(target) !== JSON.stringify(this.target)) { this.target = target; this.callbacks.focus(target); }
  }

  private hasSight(position: THREE.Vector3) {
    if (!this.space) return false;
    const distance = Math.hypot(position.x - this.camera.position.x, position.z - this.camera.position.z);
    for (let along = 0.25; along < distance - 0.25; along += 0.25) {
      const fraction = along / distance;
      const column = Math.floor(this.camera.position.x + (position.x - this.camera.position.x) * fraction);
      const row = Math.floor(this.camera.position.z + (position.z - this.camera.position.z) * fraction);
      if (this.sightHeights[row * this.space.width + column] > 1.65 - fraction * 0.25) return false;
    }
    return true;
  }

  private disposeObject(object: THREE.Object3D, external = false) {
    const dispose = (current: THREE.Object3D) => {
      if (current.userData.externalAsset && !external) {
        current.traverse(child => { if (child instanceof THREE.InstancedMesh) child.dispose(); });
        return;
      }
      if (current instanceof THREE.InstancedMesh) current.dispose();
      if (current instanceof THREE.Mesh || current instanceof THREE.Sprite) {
        if ('geometry' in current && current.geometry !== this.bodyGeometry && current.geometry !== this.headGeometry) current.geometry.dispose();
        for (const material of Array.isArray(current.material) ? current.material : [current.material]) {
          for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
          material.dispose();
        }
      }
      for (const child of current.children) dispose(child);
    };
    dispose(object);
  }

  dispose() {
    this.disposed = true; this.generation++; this.unlock(); this.renderer.setAnimationLoop(null);
    window.removeEventListener('keydown', this.keyDown); window.removeEventListener('keyup', this.keyUp);
    window.removeEventListener('blur', this.clearKeys); document.removeEventListener('visibilitychange', this.visibility);
    document.removeEventListener('pointerlockerror', this.pointerError);
    this.renderer.domElement.removeEventListener('click', this.canvasClick);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.contextLost);
    this.controls.removeEventListener('lock', this.onLock); this.controls.removeEventListener('unlock', this.onUnlock);
    this.controls.dispose(); this.observer.disconnect(); this.disposeObject(this.stage);
    this.cityObjects.dispose();
    for (const resident of this.residents.values()) this.disposeObject(resident.object);
    this.disposeObject(this.crowdBodies); this.disposeObject(this.crowdHeads); this.disposeObject(this.crowdLegs);
    for (const model of this.modelCache.values()) void model.then(object => this.disposeObject(object, true)).catch(() => {});
    this.bodyGeometry.dispose(); this.headGeometry.dispose(); this.environment.dispose(); this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
