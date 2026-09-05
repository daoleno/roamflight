import { Group, Vector3 } from 'three';

export function preparePropeller(plane) {
  const blade = plane.getObjectByName('Prop');
  if (!blade?.isMesh) throw new Error('Aircraft propeller mesh is missing.');
  blade.updateMatrix();
  // Bake the FBX pre-rotation and offset into the geometry before recentering it.
  const geometry = blade.geometry.clone().applyMatrix4(blade.matrix);
  geometry.computeBoundingBox();
  const center = geometry.boundingBox.getCenter(new Vector3());
  geometry.translate(-center.x, -center.y, -center.z);
  geometry.computeBoundingSphere();
  const pivot = new Group();
  pivot.name = 'PropellerPivot';
  pivot.position.copy(center);
  blade.parent.add(pivot);
  pivot.add(blade);
  blade.geometry.dispose();
  blade.geometry = geometry;
  blade.position.set(0, 0, 0);
  blade.quaternion.identity();
  blade.scale.setScalar(1);
  return pivot;
}

export function rotatePropeller(pivot, dt, speed) {
  pivot.rotation.z = (pivot.rotation.z + dt * (65 + speed * 35)) % (Math.PI * 2);
}
