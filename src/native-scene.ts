import type { PerspectiveCamera, Vector3, Box3, WebGLRenderer, Object3D } from 'three';
import { createNativeScene } from './native/generated/NeonCityPage-BPSPbVZP.js';
import { PlaybackClock } from './motion';
import { type Position, type Space, type WorldState } from './world';
import { WalkingSurface } from './walking-surface';
import { WalkingCache } from './walking-cache';
import { prepareFirstPersonMaterials } from './first-person-materials';
import type { FocusTarget, SceneCallbacks } from './scene';
import { AssetQueue, modelLoadConcurrency } from './asset-queue';
import { partitionStaticInstances } from './static-batches';
import { SpeechBubbles } from './speech-bubbles';

interface NativeLayout {
  heightAt: (horizontal: number, depth: number) => number;
  blockers: { bounds: Box3 }[];
  root: Object3D;
  width: number;
  height: number;
}
interface NativeControls { target: Vector3 }
interface NativeResidents { position(id: string): Vector3 | undefined }

export class CityScene {
  private native: ReturnType<typeof createNativeScene>;
  private canvas: HTMLCanvasElement;
  private world?: WorldState;
  private space?: Space;
  private camera?: PerspectiveCamera;
  private layout?: NativeLayout;
  private controls?: NativeControls;
  private residents?: NativeResidents;
  private surface?: WalkingSurface;
  private walkingCache = new WalkingCache();
  private preparation?: AbortController;
  private position: Position = { spaceId: 'central', x: 72, y: 65 };
  private yaw = 0;
  private pitch = 0;
  private keys = new Set<string>();
  private taps = new Set<string>();
  private unsampled = new Set<string>();
  private playback = new PlaybackClock();
  private target: FocusTarget | null = null;
  private previous = 0;
  private hudAt = 0;
  private frames: number[] = [];
  private renderStarted = 0;
  private renderTimes: number[] = [];
  private metricsAt = 0;
  private disposed = false;
  private loading = true;
  private assetQueue = new AssetQueue(modelLoadConcurrency(navigator));
  private diagnostics = new URLSearchParams(location.search).has('diagnostics');
  private speech: SpeechBubbles;

  constructor(container: HTMLElement, private callbacks: SceneCallbacks) {
    this.speech = new SpeechBubbles(container);
    this.native = createNativeScene(container, () => {}, status => {
      if (this.disposed) return;
      if (status.loading) { this.preparation?.abort(); this.surface = undefined; this.speech.hide(); }
      this.loading = status.loading;
      callbacks.assets(Number(status.loading), Number(!!status.error));
      callbacks.error(status.error ?? '');
    }, () => {}, () => {}, {
      load: <Result>(operation: () => Promise<Result>) => this.assetQueue.run(operation),
      ready: async (camera: PerspectiveCamera, layout: NativeLayout, controls: NativeControls, key: string | null, renderer: WebGLRenderer, scenes: Object3D[]) => {
        this.preparation?.abort();
        const preparation = new AbortController();
        this.preparation = preparation;
        this.camera = camera; this.layout = layout; this.controls = controls;
        prepareFirstPersonMaterials(layout.root);
        this.placeCamera();
        const started = performance.now();
        const cached = key ? this.walkingCache.get(key) : undefined;
        const surface = cached ?? await WalkingSurface.fromSceneAsync(layout.root, layout.width, layout.height, layout.heightAt, preparation.signal);
        if (preparation.signal.aborted || this.disposed) return;
        if (key && !cached) this.walkingCache.set(key, surface);
        const batches = partitionStaticInstances(layout.root);
        this.position = surface.nearest(this.position);
        this.previous = 0; this.frames = []; this.renderTimes = []; this.renderStarted = 0;
        this.placeCamera();
        const preparedAt = performance.now();
        for (const scene of scenes) {
          await renderer.compileAsync(scene, camera);
          if (preparation.signal.aborted || this.disposed) return;
        }
        this.surface = surface;
        if (this.diagnostics) this.canvas.dataset.walking = JSON.stringify({ collision: 'visible-geometry', space: this.space?.id, polygons: surface.polygonCount, buildMs: preparedAt - started, shaderMs: performance.now() - preparedAt, maxSliceMs: cached ? 0 : surface.maxSliceMs, cached: !!cached, batches });
      },
      frame: this.frame,
      active: () => !this.loading && !!this.surface,
      rendered: () => {
        if (this.camera && this.space && this.residents) this.speech.render(this.camera, this.space.id, id => this.residents?.position(id), (horizontal, height, depth) => this.visible(horizontal, height, depth));
        if (this.diagnostics && this.renderStarted) this.renderTimes.push(performance.now() - this.renderStarted);
      },
      time: (time: number) => this.playback.read(time),
    });
    this.canvas = container.querySelector('canvas')!;
    this.canvas.setAttribute('aria-label', 'First-person Midnight City world');
    this.canvas.dataset.renderer = 'midnight-native';
    document.addEventListener('pointerlockchange', this.onLockChange);
    document.addEventListener('pointerlockerror', this.onLockError);
    document.addEventListener('mousemove', this.onMouse);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.clearKeys);
    this.canvas.addEventListener('click', this.onClick);
  }

  update(world: WorldState) {
    this.world = world;
    this.speech.update(world);
    this.playback.observe(world.dynamicWorld.timestamp, performance.now(), world.dynamicWorld.tickRateMs);
    if (this.space) void this.native.setWorld({ ...world, agentSeeds: world.agentSeeds ?? {} }, this.space.id);
  }

  visit(spaceId: string, requested?: Position) {
    if (!this.world) return;
    const space = this.world.staticWorld.spaces.find(space => space.id === spaceId);
    if (!space) throw new Error('This location is unavailable.');
    const changed = this.space?.id !== space.id;
    this.space = space;
    const plaza = this.world.staticWorld.areas.find(area => area.spaceId === space.id && area.id === 'central-plaza');
    const destination = requested ?? plaza?.anchor ?? space.entry;
    this.position = { spaceId, x: destination.x + (requested ? 0 : 0.5), y: destination.y + (requested ? 0 : 0.5) };
    this.yaw = 0; this.pitch = 0; this.clearKeys(); this.target = null;
    if (changed) { this.preparation?.abort(); this.layout = undefined; this.surface = undefined; this.speech.hide(); }
    else if (this.surface) this.position = this.surface.nearest(this.position);
    this.placeCamera();
    this.callbacks.position(this.position, this.yaw); this.callbacks.focus(null);
    void this.native.setWorld({ ...this.world, agentSeeds: this.world.agentSeeds ?? {} }, space.id);
  }

  retry() { if (!this.disposed && !this.loading) void this.native.retry(); }

  lock() {
    if (!this.space || this.loading || !this.surface) return;
    this.canvas.focus();
    this.canvas.requestPointerLock()?.catch(() => this.onLockError());
  }

  unlock() { if (document.pointerLockElement === this.canvas) document.exitPointerLock(); this.clearKeys(); }
  private onLockChange = () => { this.clearKeys(); this.callbacks.locked(document.pointerLockElement === this.canvas); };
  private onLockError = () => this.callbacks.error('Mouse capture was unavailable. Focus the world and use WASD with the arrow keys.');
  private onVisibility = () => { if (document.hidden) this.unlock(); this.previous = 0; };
  private clearKeys = () => { this.keys.clear(); this.taps.clear(); this.unsampled.clear(); };
  private onClick = () => { if (document.pointerLockElement === this.canvas) this.interact(); else this.lock(); };
  private interact() { if (this.target) { this.unlock(); this.callbacks.interact(this.target); } }
  private onMouse = (event: MouseEvent) => {
    if (document.pointerLockElement !== this.canvas) return;
    this.yaw -= event.movementX * 0.0016;
    this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch - event.movementY * 0.0016));
  };
  private key(event: KeyboardEvent) { return event.code || (event.key.length === 1 ? `Key${event.key.toUpperCase()}` : event.key === 'Shift' ? 'ShiftLeft' : event.key); }
  private onKeyDown = (event: KeyboardEvent) => {
    if (document.pointerLockElement !== this.canvas && document.activeElement !== this.canvas) return;
    if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
    const key = this.key(event);
    if (!['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'ShiftLeft', 'ShiftRight', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) return;
    event.preventDefault();
    if (key === 'KeyE') { if (!event.repeat) this.interact(); return; }
    if (!this.keys.has(key)) this.unsampled.add(key);
    this.keys.add(key);
  };
  private onKeyUp = (event: KeyboardEvent) => {
    const key = this.key(event);
    if (this.unsampled.has(key)) this.taps.add(key);
    this.keys.delete(key); this.unsampled.delete(key);
  };

  private placeCamera() {
    if (!this.camera || !this.layout || !this.controls) return;
    const ground = this.layout.heightAt(this.position.x, this.position.y);
    this.camera.position.set(this.position.x, ground + 1.75, this.position.y);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.controls.target.set(this.position.x, ground, this.position.y);
  }

  private frame = (time: number, camera: PerspectiveCamera, layout: NativeLayout, controls: NativeControls, residents: NativeResidents, renderer: WebGLRenderer) => {
    if (this.disposed || !this.world || !this.space || this.loading || !this.surface) return;
    if (this.diagnostics) this.renderStarted = performance.now();
    this.camera = camera; this.layout = layout; this.controls = controls; this.residents = residents;
    const elapsed = this.previous ? Math.min(0.05, (time - this.previous) / 1000) : 0;
    const interval = this.previous ? time - this.previous : 0;
    this.previous = time;
    const active = (key: string) => Number(this.keys.has(key) || this.taps.has(key));
    this.yaw += (active('ArrowLeft') - active('ArrowRight')) * elapsed * 1.6;
    this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch + (active('ArrowUp') - active('ArrowDown')) * elapsed * 1.3));
    const forward = active('KeyW') - active('KeyS'), sideways = active('KeyD') - active('KeyA');
    const speed = (active('ShiftLeft') || active('ShiftRight') ? 7 : 3.6) * elapsed / Math.max(1, Math.hypot(forward, sideways));
    if ((forward || sideways) && this.surface) this.position = this.surface.move(this.position, (-Math.sin(this.yaw) * forward + Math.cos(this.yaw) * sideways) * speed, (-Math.cos(this.yaw) * forward - Math.sin(this.yaw) * sideways) * speed);
    this.taps.clear(); this.unsampled.clear(); this.placeCamera();
    if (time - this.hudAt > 100) {
      this.callbacks.position(this.position, this.yaw); this.updateFocus(); this.hudAt = time;
    }
    if (this.diagnostics) {
      if (interval && interval < 1000) this.frames.push(interval);
      if (time - this.metricsAt > 2000 && this.frames.length) {
        const sorted = [...this.frames].sort((left, right) => left - right);
        const metrics = { renderer: 'midnight-native', fps: Math.round(10000 / (this.frames.reduce((sum, value) => sum + value, 0) / this.frames.length)) / 10, p95: sorted[Math.floor(sorted.length * 0.95)], calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, residents: this.world.dynamicWorld.agents.filter(agent => agent.position.spaceId === this.space!.id).length, loading: this.loading, position: this.position, eyeHeight: camera.position.y, yaw: this.yaw, pitch: this.pitch };
        this.canvas.dataset.performance = JSON.stringify({ ...metrics, renderMs: this.renderTimes.reduce((sum, value) => sum + value, 0) / Math.max(1, this.renderTimes.length) }); this.frames = []; this.renderTimes = []; this.metricsAt = time;
      }
    }
  };

  private updateFocus() {
    if (!this.world || !this.space || !this.camera || !this.layout) return;
    let target: FocusTarget | null = null, best = 6;
    for (const agent of this.world.dynamicWorld.agents) {
      if (agent.position.spaceId !== this.space.id) continue;
      const resident = this.residents?.position(agent.id);
      if (!resident) continue;
      const horizontal = resident.x - this.position.x, depth = resident.z - this.position.y, vertical = resident.y + 1.2 - this.camera.position.y;
      const distance = Math.hypot(horizontal, depth, vertical);
      const dot = (-horizontal * Math.sin(this.yaw) * Math.cos(this.pitch) - depth * Math.cos(this.yaw) * Math.cos(this.pitch) + vertical * Math.sin(this.pitch)) / Math.max(0.01, distance);
      if (distance >= best || dot < 0.95 || !this.visible(resident.x, resident.y + 1.2, resident.z)) continue;
      best = distance; target = { kind: 'agent', id: agent.id, name: agent.name };
    }
    for (const object of this.world.dynamicWorld.resourceNodes ?? []) {
      if (object.position?.spaceId !== this.space.id) continue;
      const horizontal = object.position.x + 0.5 - this.position.x, depth = object.position.y + 0.5 - this.position.y;
      const distance = Math.hypot(horizontal, depth);
      if (distance < Math.min(best, 3) && (-horizontal * Math.sin(this.yaw) - depth * Math.cos(this.yaw)) / Math.max(.01, distance) > .94) {
        best = distance; target = { kind: 'object', object, name: object.name ?? object.kind?.replaceAll('_', ' ') ?? 'City object' };
      }
    }
    for (const portal of this.world.staticWorld.teleports) {
      if (portal.spaceId !== this.space.id) continue;
      const distance = Math.hypot((portal.bounds.minX + portal.bounds.maxX + 1) / 2 - this.position.x, (portal.bounds.minY + portal.bounds.maxY + 1) / 2 - this.position.y);
      const space = this.world.staticWorld.spaces.find(space => space.id === portal.targetSpaceId);
      if (distance < Math.min(best, 2.5) && space) { best = distance; target = { kind: 'portal', portal, name: space.name }; }
    }
    if (JSON.stringify(target) !== JSON.stringify(this.target)) { this.target = target; this.callbacks.focus(target); this.native.select(target?.kind === 'agent' ? target.id : null, false); }
  }

  private visible(horizontal: number, height: number, depth: number) {
    const origin = this.camera!.position;
    for (const { bounds } of this.layout!.blockers) {
      let near = 0, far = 1;
      for (const [axis, destination] of [['x', horizontal], ['y', height], ['z', depth]] as const) {
        const delta = destination - origin[axis];
        if (Math.abs(delta) < 1e-6) { if (origin[axis] < bounds.min[axis] || origin[axis] > bounds.max[axis]) { near = 2; break; } }
        else { const first = (bounds.min[axis] - origin[axis]) / delta, second = (bounds.max[axis] - origin[axis]) / delta; near = Math.max(near, Math.min(first, second)); far = Math.min(far, Math.max(first, second)); }
      }
      if (near < far && near < 0.98 && far > 0.02) return false;
    }
    return true;
  }

  dispose() {
    this.disposed = true; this.preparation?.abort(); this.walkingCache.clear(); this.unlock(); this.native.dispose(); this.speech.dispose();
    document.removeEventListener('pointerlockchange', this.onLockChange);
    document.removeEventListener('pointerlockerror', this.onLockError);
    document.removeEventListener('mousemove', this.onMouse);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('keydown', this.onKeyDown); window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.clearKeys); this.canvas.removeEventListener('click', this.onClick);
  }
}
