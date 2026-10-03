import type { BufferAttribute, Mesh, Object3D } from 'three';
import type { Position } from './world';

type Point = { x: number; y: number; z: number };
type Polygon = Point[];
const radius = 0.17;
const stepHeight = 0.38;
const bodyHeight = 1.7;
const resolution = 0.05;

function transform(point: Point, matrix: ArrayLike<number>): Point {
  return { x: matrix[0] * point.x + matrix[4] * point.y + matrix[8] * point.z + matrix[12], y: matrix[1] * point.x + matrix[5] * point.y + matrix[9] * point.z + matrix[13], z: matrix[2] * point.x + matrix[6] * point.y + matrix[10] * point.z + matrix[14] };
}

function clip(polygon: Polygon, height: number, above: boolean): Polygon {
  const result: Polygon = [];
  for (let index = 0; index < polygon.length; index++) {
    const start = polygon[index], end = polygon[(index + 1) % polygon.length];
    const startInside = above ? start.y >= height : start.y <= height, endInside = above ? end.y >= height : end.y <= height;
    if (startInside) result.push(start);
    if (startInside !== endInside) {
      const fraction = (height - start.y) / (end.y - start.y);
      result.push({ x: start.x + (end.x - start.x) * fraction, y: height, z: start.z + (end.z - start.z) * fraction });
    }
  }
  return result;
}

function touches(polygon: Polygon, horizontal: number, depth: number, padding = radius): boolean {
  let inside = false;
  for (let index = 0; index < polygon.length; index++) {
    const start = polygon[index], end = polygon[(index + 1) % polygon.length];
    if ((start.z > depth) !== (end.z > depth) && horizontal < (end.x - start.x) * (depth - start.z) / (end.z - start.z) + start.x) inside = !inside;
    const deltaX = end.x - start.x, deltaZ = end.z - start.z;
    const fraction = Math.max(0, Math.min(1, ((horizontal - start.x) * deltaX + (depth - start.z) * deltaZ) / Math.max(1e-12, deltaX * deltaX + deltaZ * deltaZ)));
    if ((horizontal - start.x - deltaX * fraction) ** 2 + (depth - start.z - deltaZ * fraction) ** 2 < padding * padding) return true;
  }
  return inside;
}

export class WalkingSurface {
  private blocked: Uint8Array;
  private stride: number;
  polygonCount = 0;
  maxSliceMs = 0;

  get byteLength() { return this.blocked.byteLength; }

  constructor(private width: number, private depth: number, private heightAt: (horizontal: number, depth: number) => number) {
    this.stride = Math.ceil(width / resolution) + 1;
    this.blocked = new Uint8Array(this.stride * (Math.ceil(depth / resolution) + 1));
  }

  addTriangle(triangle: Polygon, water = false) {
    for (const _checkpoint of this.rasterize(triangle, water)) { }
  }

  private *rasterize(triangle: Polygon, water: boolean): Generator<void> {
    let polygon = triangle.map(point => ({ ...point, y: point.y - this.heightAt(point.x, point.z) }));
    if (water) polygon = clip(polygon, -0.15, true);
    else polygon = clip(clip(polygon, stepHeight, true), bodyHeight, false);
    if (polygon.length < 2) return;
    const minX = Math.max(0, Math.floor(Math.min(...polygon.map(point => point.x)) / resolution));
    const maxX = Math.min(this.stride - 1, Math.floor(Math.max(...polygon.map(point => point.x)) / resolution));
    const minZ = Math.max(0, Math.floor(Math.min(...polygon.map(point => point.z)) / resolution));
    const maxZ = Math.min(Math.ceil(this.depth / resolution), Math.floor(Math.max(...polygon.map(point => point.z)) / resolution));
    let scanned = 0;
    for (let row = minZ; row <= maxZ; row++) for (let column = minX; column <= maxX; column++) {
      const key = row * this.stride + column;
      if (!this.blocked[key] && touches(polygon, (column + .5) * resolution, (row + .5) * resolution, resolution * Math.SQRT1_2)) this.blocked[key] = 1;
      if (++scanned % 2048 === 0) yield;
    }
    this.polygonCount++;
  }

  static fromScene(root: Object3D, width: number, depth: number, heightAt: (horizontal: number, depth: number) => number) {
    const surface = new WalkingSurface(width, depth, heightAt);
    for (const _checkpoint of surface.readScene(root)) { }
    return surface;
  }

  static async fromSceneAsync(root: Object3D, width: number, depth: number, heightAt: (horizontal: number, depth: number) => number, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const surface = new WalkingSurface(width, depth, heightAt);
    let started = performance.now();
    const scheduler = (globalThis as typeof globalThis & { scheduler?: { yield: () => Promise<void> } }).scheduler;
    for (const _checkpoint of surface.readScene(root)) {
      signal?.throwIfAborted();
      const elapsed = performance.now() - started;
      if (elapsed < 6) continue;
      surface.maxSliceMs = Math.max(surface.maxSliceMs, elapsed);
      if (scheduler?.yield) await scheduler.yield();
      else await new Promise<void>(resolve => setTimeout(resolve, 0));
      signal?.throwIfAborted();
      started = performance.now();
    }
    signal?.throwIfAborted();
    surface.maxSliceMs = Math.max(surface.maxSliceMs, performance.now() - started);
    return surface;
  }

  private *readScene(root: Object3D): Generator<void> {
    root.updateMatrixWorld(true);
    const meshes: Mesh[] = [];
    root.traverse(object => {
      const mesh = object as Mesh;
      if (!mesh.isMesh || !mesh.visible || mesh.userData.flatDetail) return;
      let ancestor: Object3D | null = mesh.parent;
      while (ancestor) { if (!ancestor.visible) return; ancestor = ancestor.parent; }
      meshes.push(mesh);
    });
    let triangles = 0;
    for (const mesh of meshes) {
      yield;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (materials.every(material => /^(leaf|foliage|sign-|Poster art|jet|cyan|brass)/.test(material.name))) continue;
      const water = !!mesh.userData.waterSurface || materials.some(material => /^(water|pool-water|fountain-water)$/.test(material.name));
      if (!water && materials.every(material => !material.visible || material.opacity < 0.25 || !material.depthWrite)) continue;
      const positions = mesh.geometry.getAttribute('position') as BufferAttribute | undefined;
      if (!positions) continue;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const bounds = mesh.geometry.boundingBox!;
      const instanced = mesh as Mesh & { isInstancedMesh?: boolean; count: number; instanceMatrix: { array: ArrayLike<number> } };
      const indices = mesh.geometry.index;
      const instances = instanced.isInstancedMesh ? instanced.count : 1;
      for (let instance = 0; instance < instances; instance++) {
        yield;
        const instanceMatrix = instanced.isInstancedMesh ? Array.from({ length: 16 }, (_, index) => instanced.instanceMatrix.array[instance * 16 + index]) : undefined;
        const worldPoint = (point: Point) => transform(instanceMatrix ? transform(point, instanceMatrix) : point, mesh.matrixWorld.elements);
        let lowest = Infinity, highest = -Infinity;
        for (const horizontal of [bounds.min.x, bounds.max.x]) for (const height of [bounds.min.y, bounds.max.y]) for (const depth of [bounds.min.z, bounds.max.z]) {
          const point = worldPoint({ x: horizontal, y: height, z: depth }), relative = point.y - this.heightAt(point.x, point.z);
          lowest = Math.min(lowest, relative); highest = Math.max(highest, relative);
        }
        if (!water && (highest < stepHeight || lowest > bodyHeight)) continue;
        const vertex = (index: number) => {
          const offset = indices ? indices.getX(index) : index;
          return worldPoint({ x: positions.getX(offset), y: positions.getY(offset), z: positions.getZ(offset) });
        };
        const count = indices ? indices.count : positions.count;
        for (let index = 0; index + 2 < count; index += 3) {
          yield* this.rasterize([vertex(index), vertex(index + 1), vertex(index + 2)], water);
          if (++triangles % 128 === 0) yield;
        }
      }
    }
  }

  canStand(horizontal: number, depth: number) {
    if (!Number.isFinite(horizontal) || !Number.isFinite(depth) || horizontal < radius || depth < radius || horizontal > this.width - radius || depth > this.depth - radius) return false;
    for (let row = Math.max(0, Math.floor((depth - radius) / resolution)); row <= Math.floor((depth + radius) / resolution); row++) {
      for (let column = Math.max(0, Math.floor((horizontal - radius) / resolution)); column <= Math.floor((horizontal + radius) / resolution); column++) {
        if (!this.blocked[row * this.stride + column]) continue;
        const nearestX = Math.max(column * resolution, Math.min((column + 1) * resolution, horizontal));
        const nearestZ = Math.max(row * resolution, Math.min((row + 1) * resolution, depth));
        if ((horizontal - nearestX) ** 2 + (depth - nearestZ) ** 2 < radius * radius) return false;
      }
    }
    return true;
  }

  nearest(requested: Position): Position {
    const origin = { ...requested, x: Math.max(radius, Math.min(this.width - radius, requested.x)), y: Math.max(radius, Math.min(this.depth - radius, requested.y)) };
    if (this.canStand(origin.x, origin.y)) return origin;
    for (let distance = 0.25; distance < Math.max(this.width, this.depth); distance += 0.25) {
      const steps = Math.max(16, Math.ceil(distance * Math.PI * 8));
      for (let step = 0; step < steps; step++) {
        const angle = step / steps * Math.PI * 2, horizontal = origin.x + Math.cos(angle) * distance, depth = origin.y + Math.sin(angle) * distance;
        if (this.canStand(horizontal, depth)) return { ...origin, x: horizontal, y: depth };
      }
    }
    throw new Error('No open walking surface was found here.');
  }

  move(position: Position, horizontal: number, depth: number): Position {
    const steps = Math.max(1, Math.ceil(Math.hypot(horizontal, depth) / 0.08));
    const deltaX = horizontal / steps, deltaZ = depth / steps;
    const next = { ...position };
    for (let step = 0; step < steps; step++) {
      if (this.canStand(next.x + deltaX, next.y + deltaZ)) { next.x += deltaX; next.y += deltaZ; }
      else {
        if (this.canStand(next.x + deltaX, next.y)) next.x += deltaX;
        if (this.canStand(next.x, next.y + deltaZ)) next.y += deltaZ;
      }
    }
    return next;
  }
}
