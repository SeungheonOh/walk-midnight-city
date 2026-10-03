import type { Mesh, Object3D } from 'three';

function drapeCover(cover: Mesh, mattress: Mesh) {
  const geometry = cover.geometry.clone();
  geometry.computeBoundingBox(); mattress.geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!, mattressBounds = mattress.geometry.boundingBox!;
  const position = geometry.getAttribute('position');
  const plateau = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (let index = 0; index < position.count; index++) {
    if (position.getY(index) < bounds.max.y - .05) continue;
    plateau.minX = Math.min(plateau.minX, position.getX(index)); plateau.maxX = Math.max(plateau.maxX, position.getX(index));
    plateau.minZ = Math.min(plateau.minZ, position.getZ(index)); plateau.maxZ = Math.max(plateau.maxZ, position.getZ(index));
  }
  function remap(value: number, low: number, innerLow: number, innerHigh: number, high: number, mattressLow: number, mattressHigh: number) {
    if (!Number.isFinite(innerLow) || innerHigh <= innerLow) return value;
    const targetLow = innerLow - low > .02 ? Math.min(innerLow, Math.max(low + .02, mattressLow - .02)) : innerLow;
    const targetHigh = high - innerHigh > .02 ? Math.max(innerHigh, Math.min(high - .02, mattressHigh + .02)) : innerHigh;
    if (value < innerLow) return low + (value - low) / (innerLow - low) * (targetLow - low);
    if (value > innerHigh) return targetHigh + (value - innerHigh) / (high - innerHigh) * (high - targetHigh);
    return targetLow + (value - innerLow) / (innerHigh - innerLow) * (targetHigh - targetLow);
  }
  for (let index = 0; index < position.count; index++) {
    position.setX(index, remap(position.getX(index), bounds.min.x, plateau.minX, plateau.maxX, bounds.max.x, mattressBounds.min.x, mattressBounds.max.x));
    position.setZ(index, remap(position.getZ(index), bounds.min.z, plateau.minZ, plateau.maxZ, bounds.max.z, mattressBounds.min.z, mattressBounds.max.z));
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  cover.geometry = geometry;
}

export function prepareFirstPersonMaterials(root: Object3D) {
  if (root.userData.firstPersonMaterials) return;
  root.userData.firstPersonMaterials = true;
  const beds = new Map<string, { cover?: Mesh; mattress?: Mesh }>();
  root.traverse(object => {
    const mesh = object as Mesh;
    if (!mesh.isMesh || !mesh.userData.walkableFurnishing || mesh.geometry.type === 'PlaneGeometry') return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (mesh.name.startsWith('charging-bed-')) {
      const bed = beds.get(mesh.name) ?? {};
      if (materials.some(material => material.name === 'cream')) bed.mattress = mesh;
      if (materials.some(material => material.name.startsWith('fabric-bed-'))) bed.cover = mesh;
      beds.set(mesh.name, bed);
    }
    for (const material of materials) {
      if (material.transparent || material.opacity < 1) continue;
      material.depthTest = true;
      material.depthWrite = true;
    }
    mesh.renderOrder = 0;
  });
  for (const { cover, mattress } of beds.values()) if (cover && mattress) drapeCover(cover, mattress);
}
