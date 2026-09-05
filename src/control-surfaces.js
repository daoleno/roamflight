import { Group, MathUtils, Mesh, MeshBasicMaterial, SphereGeometry, Vector3 } from 'three';

export function prepareControlSurfaces(plane) {
  const ailerons = [
    ['Aileron_left', -1],
    ['Aileron_right', 1],
  ].map(([name, direction]) => {
    const mesh = plane.getObjectByName(name);
    if (!mesh?.isMesh) throw new Error(`Missing aircraft control surface: ${name}`);
    mesh.updateMatrix();
    const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrix);
    geometry.computeBoundingBox();
    const hinge = geometry.boundingBox.getCenter(new Vector3());
    // The model points along +Z; the front edge of each trailing aileron is its hinge.
    hinge.z = geometry.boundingBox.max.z;
    geometry.translate(-hinge.x, -hinge.y, -hinge.z);
    geometry.computeBoundingSphere();
    const pivot = new Group();
    pivot.name = `${name}_hinge`;
    pivot.position.copy(hinge);
    mesh.parent.add(pivot);
    pivot.add(mesh);
    mesh.geometry.dispose();
    mesh.geometry = geometry;
    mesh.position.set(0, 0, 0);
    mesh.quaternion.identity();
    mesh.scale.setScalar(1);
    return { pivot, mesh, direction };
  });
  const lights = new Group();
  lights.name = 'NavigationLights';
  lights.visible = false;
  const geometry = new SphereGeometry(1.35, 10, 8);
  for (const [name, color, position] of [
    ['PortLight', 0xff382c, [76.2, 27.5, 18]],
    ['StarboardLight', 0x53ff88, [-76.2, 27.5, 18]],
    ['TailLight', 0xffffff, [0, 31, -40]],
  ]) {
    const light = new Mesh(
      geometry,
      new MeshBasicMaterial({ color, transparent: true, opacity: 0, toneMapped: false }),
    );
    light.name = name;
    light.position.fromArray(position);
    lights.add(light);
  }
  plane.add(lights);
  return { ailerons, lights };
}

export function updateControlSurfaces(controls, turn, night, dt) {
  for (const { pivot, direction } of controls.ailerons) {
    pivot.rotation.x = MathUtils.damp(
      pivot.rotation.x,
      MathUtils.clamp(turn, -1, 1) * direction * MathUtils.degToRad(20),
      8,
      dt,
    );
  }
  const strength = MathUtils.clamp(night, 0, 1);
  controls.lights.visible = strength > 0.02;
  for (const light of controls.lights.children) light.material.opacity = strength * 0.95;
}
