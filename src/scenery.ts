import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Bounds, Space, StaticWorld } from './world';

export interface Placement { model: string; x: number; z: number; y?: number; scale?: number; scaleX?: number; scaleY?: number; scaleZ?: number; rotation?: number }
export interface BuildingPlacement { model: string; name: string; bounds: Bounds }

const centralBlocks: [string, string, number, number, number, number][] = [
  ['North residence', 'urban-house', 82.78, 16, 3.57, 2], ['North shop', 'urban-shop', 78.86, 10, 7.79, 3],
  ['North diner', 'urban-diner', 85.8, 11, 5.88, 2], ['North residence', 'urban-house', 91.07, 11, 4.19, 2],
  ['North shop', 'urban-shop', 79.38, 16, 3.79, 2], ['North diner', 'urban-diner', 85.66, 16, 3.54, 2],
  ['North residence', 'urban-house', 88.65, 16, 3.88, 2], ['North shop', 'urban-shop', 95.07, 11, 5.17, 2],
  ['North diner', 'urban-diner', 99.79, 11, 5.92, 2], ['North residence', 'urban-house', 105.08, 11, 4.3, 2],
  ['North shop', 'urban-shop', 91.93, 16, 5, 2], ['North diner', 'urban-diner', 96.68, 16, 4.38, 2],
  ['North residence', 'urban-house', 103.17, 18, 3.75, 2], ['North shop', 'urban-shop', 103.18, 16, 3.75, 2],
  ['North diner', 'urban-diner', 79.47, 28, 4.38, 2], ['North residence', 'urban-house', 79.47, 22, 4.38, 2],
  ['North shop', 'urban-shop', 100.97, 31, 7.13, 3], ['Bank', 'bank', 35.03, 26, 13.94, 10],
  ['Power yard', 'substation', 42, 12, 12, 9], ['Farm cottage', 'farm-house', 35, 74, 9, 7],
  ['North barn', 'barn', 12, 80, 8, 6], ['South barn', 'barn', 12, 95, 9, 6],
  ['Farm windmill', 'windmill', 12, 85, 5, 9], ['West greenhouse', 'greenhouse', 34, 86, 9, 9],
  ['East greenhouse', 'greenhouse', 44, 88, 6, 8], ['Water tower', 'water-tower', 52, 87, 5, 8],
  ['Water tower', 'water-tower', 60, 87, 5, 8], ['Farm store', 'barn', 44, 79, 4, 7],
  ['Night hotel', 'tower-0', 95, 53, 11, 18], ['Sky apartments', 'foundation', 106, 52, 7, 12],
  ['Corner arcade', 'urban-house', 114, 52, 8, 10], ['East offices', 'hacker', 122, 58, 4, 15],
  ['Cyber bar', 'tower-1', 113, 64, 9, 11], ['Night arcade', 'tower-0', 95, 74, 11, 13],
  ['Private room', 'urban-shop', 110, 64, 3, 8], ['Central station', 'station', 106, 97, 38, 6],
  ['Station gatehouse', 'workshop', 130, 87, 11, 5], ['Freight depot', 'workshop', 82, 104, 10, 10],
  ['Freight depot', 'workshop', 93, 104, 11, 10], ['Freight crane', 'freight-crane', 105, 104, 8, 10],
  ['Freight store', 'workshop', 128, 105, 12, 8],
];

export function extraBuildings(space: Space): BuildingPlacement[] {
  if (space.id !== 'central' || space.width !== 144 || space.height !== 114) return [];
  return centralBlocks.map(([name, model, horizontal, depth, width, height]) => ({ name, model,
    bounds: { minX: Math.floor(horizontal), minY: depth, maxX: Math.ceil(horizontal + width) - 1, maxY: depth + height - 1 } }));
}

export function sceneryPlan(world: StaticWorld, space: Space, covered: Set<string>): Placement[] {
  if (space.kind === 'interior') return [];
  const placements: Placement[] = [];
  const used = new Set<string>();
  const add = (model: string, horizontal: number, depth: number, scale = 1, rotation = 0) => {
    const key = `${Math.floor(horizontal)},${Math.floor(depth)}`;
    const cell = world.cells[`${space.id},${key}`];
    if (!cell || covered.has(key) || used.has(key) || cell.terrain === 'road' || cell.terrain === 'water' || cell.traversability !== 'blocked') return;
    used.add(key); placements.push({ model, x: horizontal, z: depth, scale, rotation });
  };
  const areas = world.areas.filter(area => area.spaceId === space.id);
  const plaza = areas.find(area => area.id === 'central-plaza');
  if (plaza?.anchor && plaza.bounds) {
    const center = plaza.anchor.x + 1, top = plaza.bounds.minY;
    add('fountain', center, top + 17.125, 1.3);
    for (const side of [-1, 1]) {
      add('fountain', center + side * 11, top + 10, 1.1);
      add('billboard', center + side * 13, top + 7, 1.2);
      for (const depth of [-1, 3.5]) add('tree', center + side * 14, top + depth, 1.5);
      for (const depth of [-12, -7]) add('garden-tree', center + side * 10.8, top + depth);
      for (const depth of [8, 16, 24, 28]) {
        add('lamp', center + side * 7.2, top + depth, 1.45);
        add('lamp', center + side * 17.5, top + depth, 1.45);
        add('bench', center + side * 13, top + depth - 1.5, 1, side > 0 ? Math.PI : 0);
      }
      for (const horizontal of [11, 14]) for (const depth of [1, 5, 9, 17, 27]) add('planter', center + side * horizontal, top + depth, 0.7);
      for (const depth of [11, 22]) add('parked-car', center + side * 3.8, plaza.bounds.maxY + depth);
      for (const depth of [9, 19, 29]) add('lamp', center + side * 8, plaza.bounds.maxY + depth, 1.45);
      add('street-bin', center + side * 7, plaza.bounds.maxY + 0.5);
      add('bollard', center + side * 5, plaza.bounds.maxY + 0.5);
    }
    for (const [index, offset] of [-12.25, -6.75, 7.75, 13.25].entries()) for (const depth of [19, 25]) add(`market-${index % 3}`, center + offset, top + depth + 0.5);
  }
  for (const area of areas) {
    if (area.anchor) {
      add('lamp', area.anchor.x - 0.5, area.anchor.y + 0.5, 1.35);
      add('bench', area.anchor.x + 1.5, area.anchor.y + 0.5, 0.9);
    }
    if (!area.bounds || area.kind !== 'park' || ['central-plaza', 'partner-plaza', 'bison-valley', 'foundation-canal', 'nexifuse'].includes(area.id)) continue;
    for (let row = area.bounds.minY + 2; row < area.bounds.maxY; row += 5) for (let column = area.bounds.minX + 2; column < area.bounds.maxX; column += 5) add('district-tree', column + 0.5, row + 0.5, 0.9 + (column % 3) * 0.1);
  }
  let trees = 0;
  for (let row = 3; row < space.height - 3; row += 6) for (let column = 3; column < space.width - 3; column += 6) {
    const nearbyRoad = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([offsetX, offsetY]) => world.cells[`${space.id},${column + offsetX},${row + offsetY}`]?.terrain === 'road');
    if (nearbyRoad) { add('lamp', column + 0.5, row + 0.5, 1.25); add('street-bin', column + 1.5, row + 0.5, 0.8); }
    else if (space.id !== 'central' && trees++ < 70) add('district-tree', column + 0.5, row + 0.5, 1);
  }
  return placements;
}

export function prepareModel(original: THREE.Group) {
  original.updateMatrixWorld(true);
  original.traverse(child => {
    if (!(child instanceof THREE.Mesh) || child.geometry.getAttribute('color')?.itemSize !== 4) return;
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
      if (!(material instanceof THREE.MeshStandardMaterial) || material.userData.cityLighting) continue;
      material.userData.cityLighting = true;
      material.onBeforeCompile = shader => {
        shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#ifdef USE_COLOR_ALPHA\n diffuseColor.rgb *= 0.4 + 0.6 * vColor.a;\n #else\n #include <color_fragment>\n #endif');
        shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n #ifdef USE_COLOR_ALPHA\n totalEmissiveRadiance += diffuseColor.rgb * vColor.rgb * 2.0;\n #endif');
      };
      material.customProgramCacheKey = () => 'city-baked-light-v1';
      if (material.transparent) material.depthWrite = false;
      if (material.name === 'jet') { material.emissive.set('#148edb'); material.emissiveIntensity = 0.9; material.vertexColors = false; }
    }
  });
  const parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  original.traverse(child => {
    if (!(child instanceof THREE.Mesh) || child instanceof THREE.SkinnedMesh) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    const source = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone();
    const groups = child.geometry.groups.length ? child.geometry.groups : [{ start: 0, count: source.getAttribute('position').count, materialIndex: 0 }];
    for (const group of groups) {
      const geometry = new THREE.BufferGeometry();
      for (const attributeName of ['position', 'normal', 'uv', 'color']) {
        const attribute = source.getAttribute(attributeName);
        const size = attributeName === 'uv' ? 2 : attributeName === 'color' ? 4 : 3;
        const values = new Float32Array(group.count * size);
        if (attributeName === 'color') values.fill(1);
        if (attribute) for (let index = 0; index < group.count; index++) for (let component = 0; component < Math.min(size, attribute.itemSize); component++) values[index * size + component] = attribute.getComponent(group.start + index, component);
        geometry.setAttribute(attributeName, new THREE.BufferAttribute(values, size));
      }
      geometry.applyMatrix4(child.matrixWorld);
      const material = materials[Array.isArray(child.material) ? group.materialIndex ?? 0 : 0];
      const geometries = parts.get(material) ?? []; geometries.push(geometry); parts.set(material, geometries);
    }
    source.dispose();
  });
  const prepared = new THREE.Group(); prepared.userData.externalAsset = true;
  for (const [material, geometries] of parts) {
    const geometry = mergeGeometries(geometries);
    for (const part of geometries) part.dispose();
    if (geometry) prepared.add(new THREE.Mesh(geometry, material));
  }
  return prepared;
}

export function instanceScenery(model: THREE.Group, placements: Placement[]) {
  const root = new THREE.Group(); root.name = 'scenery-batch'; root.userData.externalAsset = true;
  root.userData.placements = placements.length;
  const transform = new THREE.Object3D();
  for (const part of model.children) {
    if (!(part instanceof THREE.Mesh)) continue;
    const mesh = new THREE.InstancedMesh(part.geometry, part.material, placements.length);
    placements.forEach((placement, index) => {
      transform.position.set(placement.x, placement.y ?? 0, placement.z); transform.rotation.y = placement.rotation ?? 0;
      transform.scale.set(placement.scaleX ?? placement.scale ?? 1, placement.scaleY ?? placement.scale ?? 1, placement.scaleZ ?? placement.scale ?? 1);
      transform.updateMatrix(); mesh.setMatrixAt(index, transform.matrix);
    });
    mesh.computeBoundingSphere(); root.add(mesh);
  }
  return root;
}
