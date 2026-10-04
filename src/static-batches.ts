import type { BufferGeometry, InstancedBufferAttribute, InstancedMesh, Material, Object3D } from 'three';

export function partitionStaticInstances(root: Object3D) {
  const stats = { splitMeshes: 0, batches: 0, instances: 0 };
  if (root.userData.spatialBatches) return stats;
  root.userData.spatialBatches = true;
  root.updateMatrixWorld(true);
  const candidates: InstancedMesh[] = [];
  root.traverse(object => {
    const mesh = object as InstancedMesh;
    if (!mesh.isInstancedMesh || mesh.count < 8 || !mesh.visible || !mesh.frustumCulled || mesh.children.length || mesh.morphTexture) return;
    if (mesh.instanceColor && mesh.instanceColor.meshPerAttribute !== 1) return;
    const triangles = (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position')?.count ?? 0) / 3;
    if (triangles < 1000 || triangles * mesh.count < 50000) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (materials.some(material => material.transparent || material.type === 'ShaderMaterial' || material.type === 'RawShaderMaterial')) return;
    if (Object.values(mesh.geometry.attributes).some(attribute => (attribute as InstancedBufferAttribute).isInstancedBufferAttribute)) return;
    candidates.push(mesh);
  });
  for (const source of candidates) {
    const groups = new Map<string, number[]>();
    const matrix = source.matrix.clone();
    const worldMatrix = source.matrixWorld.clone();
    for (let index = 0; index < source.count; index++) {
      source.getMatrixAt(index, matrix);
      worldMatrix.multiplyMatrices(source.matrixWorld, matrix);
      const key = `${Math.floor(worldMatrix.elements[12] / 32)},${Math.floor(worldMatrix.elements[14] / 32)}`;
      const indices = groups.get(key) ?? [];
      indices.push(index); groups.set(key, indices);
    }
    if (groups.size < 2) continue;
    const MeshClass = source.constructor as new (geometry: BufferGeometry, material: Material | Material[], count: number) => InstancedMesh;
    for (const indices of groups.values()) {
      const batch = new MeshClass(source.geometry, source.material, indices.length);
      batch.name = source.name;
      batch.userData = { ...source.userData };
      batch.position.copy(source.position); batch.quaternion.copy(source.quaternion); batch.scale.copy(source.scale);
      batch.matrix.copy(source.matrix); batch.matrixWorld.copy(source.matrixWorld);
      batch.matrixAutoUpdate = source.matrixAutoUpdate; batch.matrixWorldAutoUpdate = source.matrixWorldAutoUpdate;
      batch.layers.mask = source.layers.mask; batch.renderOrder = source.renderOrder;
      batch.castShadow = source.castShadow; batch.receiveShadow = source.receiveShadow;
      batch.customDepthMaterial = source.customDepthMaterial; batch.customDistanceMaterial = source.customDistanceMaterial;
      batch.onBeforeRender = source.onBeforeRender; batch.onAfterRender = source.onAfterRender;
      batch.instanceMatrix.setUsage(source.instanceMatrix.usage);
      for (let index = 0; index < indices.length; index++) {
        source.getMatrixAt(indices[index], matrix); batch.setMatrixAt(index, matrix);
      }
      if (source.instanceColor) {
        const AttributeClass = source.instanceColor.constructor as new (array: InstancedBufferAttribute['array'], itemSize: number, normalized: boolean) => InstancedBufferAttribute;
        const ArrayClass = source.instanceColor.array.constructor as new (length: number) => InstancedBufferAttribute['array'];
        const colors = new ArrayClass(indices.length * source.instanceColor.itemSize);
        for (let index = 0; index < indices.length; index++) {
          const offset = indices[index] * source.instanceColor.itemSize;
          colors.set(source.instanceColor.array.slice(offset, offset + source.instanceColor.itemSize), index * source.instanceColor.itemSize);
        }
        batch.instanceColor = new AttributeClass(colors, source.instanceColor.itemSize, source.instanceColor.normalized);
        batch.instanceColor.setUsage(source.instanceColor.usage);
      }
      batch.computeBoundingBox(); batch.computeBoundingSphere();
      source.parent!.add(batch);
      stats.batches++; stats.instances += batch.count;
    }
    source.removeFromParent(); source.dispose(); stats.splitMeshes++;
  }
  return stats;
}
