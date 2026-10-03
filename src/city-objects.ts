import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MotionTrack } from './motion';
import type { CityObject, WorldState } from './world';

interface ObservedObject { key: string; data: CityObject; position: THREE.Vector3; motion: MotionTrack; kind: string }

function objectGeometry(kind: string) {
  const parts: THREE.BufferGeometry[] = [];
  const add = (shape: THREE.BufferGeometry, color: string, horizontal: number, height: number, depth: number) => {
    const geometry = shape.index ? shape.toNonIndexed() : shape.clone(); shape.dispose();
    geometry.deleteAttribute('uv'); geometry.translate(horizontal, height, depth);
    const tint = new THREE.Color(color), colors = new Float32Array(geometry.getAttribute('position').count * 3);
    for (let index = 0; index < colors.length; index += 3) { colors[index] = tint.r; colors[index + 1] = tint.g; colors[index + 2] = tint.b; }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3)); parts.push(geometry);
  };
  const box = (width: number, height: number, depth: number, color: string, elevation: number, horizontal = 0, vertical = 0) => add(new THREE.BoxGeometry(width, height, depth), color, horizontal, elevation, vertical);
  if (kind === 'tree_stand') {
    add(new THREE.CylinderGeometry(0.12, 0.2, 2.5, 7), '#67513d', 0, 1.25, 0);
    add(new THREE.IcosahedronGeometry(1.05, 1), '#447658', 0, 2.5, 0);
    add(new THREE.IcosahedronGeometry(0.7, 0), '#648853', 0.55, 2.15, 0.15);
  } else if (kind === 'crop_bed') {
    box(0.85, 0.18, 0.85, '#665042', 0.1);
    for (const offset of [-0.25, 0.25]) for (const depth of [-0.25, 0.25]) add(new THREE.ConeGeometry(0.13, 0.48, 5), '#86ac61', offset, 0.4, depth);
  } else if (kind === 'ore_vein' || kind === 'salvage_pile') {
    add(new THREE.DodecahedronGeometry(0.42), kind === 'ore_vein' ? '#7b97b0' : '#936b48', 0, 0.35, 0);
    add(new THREE.DodecahedronGeometry(0.23), '#aec4d5', 0.25, 0.2, 0.2);
  } else if (kind === 'crypto_terminal') {
    box(0.85, 0.12, 0.6, '#333e52', 0.78); box(0.6, 0.55, 0.13, '#61d5e3', 1.1, 0, -0.15);
    box(0.16, 0.75, 0.4, '#596376', 0.38, -0.3); box(0.16, 0.75, 0.4, '#596376', 0.38, 0.3);
  } else if (kind === 'energy_tap') {
    add(new THREE.CylinderGeometry(0.26, 0.3, 1.2, 8), '#465064', 0, 0.6, 0);
    add(new THREE.IcosahedronGeometry(0.25, 1), '#7be3e7', 0, 1.3, 0);
  } else if (kind === 'fishing_spot') {
    add(new THREE.CylinderGeometry(0.44, 0.44, 0.04, 16), '#3b839b', 0, 0.03, 0);
    box(0.08, 1.2, 0.08, '#e0b574', 0.6, 0.35);
  } else if (kind === 'merchant') {
    box(1.1, 0.8, 0.7, '#725448', 0.4); box(1.35, 0.18, 0.95, '#7f75ab', 1.9);
    for (const offset of [-0.52, 0.52]) box(0.07, 1.7, 0.07, '#ba9a72', 0.95, offset, -0.25);
    box(0.8, 0.2, 0.45, '#ccac67', 0.95);
  } else if (kind === 'animal' || kind === 'enemy') {
    box(0.48, 0.42, 0.8, kind === 'enemy' ? '#a4565e' : '#9b8463', 0.65);
    add(new THREE.IcosahedronGeometry(0.25, 0), kind === 'enemy' ? '#d67c72' : '#c6b894', 0, 0.86, 0.45);
    for (const offset of [-0.17, 0.17]) for (const depth of [-0.26, 0.26]) box(0.09, 0.48, 0.09, '#504753', 0.24, offset, depth);
  } else if (kind === 'agility_obstacle') {
    box(0.9, 0.16, 0.3, '#e9a966', 0.8);
    for (const offset of [-0.35, 0.35]) box(0.1, 0.8, 0.16, '#718da3', 0.4, offset);
  } else { box(0.72, 0.55, 0.6, '#547b83', 0.28); box(0.78, 0.08, 0.66, '#b9a275', 0.6); }
  const geometry = mergeGeometries(parts)!;
  parts.forEach(part => part.dispose()); return geometry;
}

export class CityObjects {
  readonly root = new THREE.Group();
  readonly objects = new Map<string, ObservedObject>();
  private meshes = new Map<string, THREE.InstancedMesh>();
  private geometry = new Map<string, THREE.BufferGeometry>();
  private material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  private transform = new THREE.Object3D();
  private tint = new THREE.Color();

  update(world: WorldState, spaceId: string) {
    const dynamic = world.dynamicWorld;
    const groups: [string, CityObject[]][] = [['resource', dynamic.resourceNodes ?? []], ['npc', dynamic.npcs ?? []], ['enemy', dynamic.enemies ?? []], ['outlet', dynamic.merchantOutlets ?? []]];
    const present = new Set<string>();
    for (const [family, entries] of groups) for (const data of entries) {
      if (data.position?.spaceId !== spaceId || data.available === false) continue;
      const key = `${family}:${data.id ?? data.name}`;
      const kind = family === 'enemy' ? 'enemy' : data.kind ?? 'secure_cache';
      present.add(key);
      let object = this.objects.get(key);
      if (!object) {
        object = { key, data, kind, position: new THREE.Vector3(data.position.x + 0.5, 0, data.position.y + 0.5), motion: new MotionTrack() };
        this.objects.set(key, object);
      }
      object.data = data; object.motion.push(data.position, dynamic.timestamp);
    }
    for (const key of this.objects.keys()) if (!present.has(key)) this.objects.delete(key);
    const counts = new Map<string, number>();
    for (const object of this.objects.values()) counts.set(object.kind, (counts.get(object.kind) ?? 0) + 1);
    for (const [kind, count] of counts) {
      let mesh = this.meshes.get(kind);
      if (!mesh || mesh.instanceMatrix.count < count) {
        if (mesh) { this.root.remove(mesh); mesh.dispose(); }
        let geometry = this.geometry.get(kind);
        if (!geometry) { geometry = objectGeometry(kind); this.geometry.set(kind, geometry); }
        mesh = new THREE.InstancedMesh(geometry, this.material, Math.max(16, 2 ** Math.ceil(Math.log2(count))));
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false;
        this.meshes.set(kind, mesh); this.root.add(mesh);
      }
    }
  }

  render(time: number) {
    const counts = new Map<string, number>();
    for (const object of this.objects.values()) {
      object.motion.write(time, object.position);
      const index = counts.get(object.kind) ?? 0, mesh = this.meshes.get(object.kind)!;
      const depleted = object.data.state === 'depleted';
      this.transform.position.copy(object.position); this.transform.scale.setScalar(depleted ? 0.55 : 1); this.transform.updateMatrix();
      mesh.setMatrixAt(index, this.transform.matrix); mesh.setColorAt(index, this.tint.set(depleted ? '#797979' : '#ffffff'));
      counts.set(object.kind, index + 1);
    }
    for (const [kind, mesh] of this.meshes) {
      mesh.count = counts.get(kind) ?? 0; mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  dispose() {
    for (const mesh of this.meshes.values()) mesh.dispose();
    for (const geometry of this.geometry.values()) geometry.dispose();
    this.material.dispose(); this.root.clear(); this.objects.clear();
  }
}
