import * as THREE from 'three';
import type { Space, StaticWorld } from './world';

export function groundMeshes(world: StaticWorld, space: Space) {
  const groups = new Map<string, number[]>();
  for (let row = 0; row < space.height; row++) {
    let start = 0;
    while (start < space.width) {
      const terrain = world.cells[`${space.id},${start},${row}`]?.terrain ?? 'ground';
      let end = start + 1;
      while (end < space.width && world.cells[`${space.id},${end},${row}`]?.terrain === terrain) end++;
      const vertices = groups.get(terrain) ?? [];
      vertices.push(start, 0, row, start, 0, row + 1, end, 0, row + 1, start, 0, row, end, 0, row + 1, end, 0, row);
      groups.set(terrain, vertices); start = end;
    }
  }
  const colors: Record<string, string> = { road: '#263346', ground: '#566170', interior: '#62554c', water: '#224a62' };
  return [...groups].map(([terrain, vertices]) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: colors[terrain] ?? colors.ground, roughness: 0.92 }));
    mesh.name = `ground-${terrain}`;
    return mesh;
  });
}
