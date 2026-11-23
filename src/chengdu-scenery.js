import * as T from 'three';
import { project } from './chengdu-geo.js';

export const relief = 2.2 / 1000;

export function terrainMesh(atlas, terrain, heights, surface) {
  const { left, right, top, bottom } = terrain,
    [cols, rows] = atlas.grid;
  const geom = new T.PlaneGeometry(right - left, bottom - top, cols - 1, rows - 1);
  geom.rotateX(-Math.PI / 2);
  geom.translate((right + left) / 2, 0, (top + bottom) / 2);
  const pos = geom.attributes.position;
  for (let i = 0; i < heights.length; i++) pos.setY(i, heights[i] * relief);
  geom.computeVertexNormals();
  surface.colorSpace = T.SRGBColorSpace;
  surface.anisotropy = 4;
  return new T.Mesh(geom, new T.MeshLambertMaterial({ map: surface }));
}
export function boundaries(atlas, terrain) {
  const group = new T.Group();
  for (const [index, areas] of [
    [1, atlas.areas.slice(1)],
    [0, atlas.areas.slice(0, 1)],
  ]) {
    const pos = [];
    for (const area of areas)
      for (const polygon of area.polygons)
        for (const ring of polygon) {
          let previous;
          for (const coord of ring) {
            const [x, z] = project(coord);
            const point = [x, terrain.meters(x, z) * relief + 0.12, z];
            if (previous) pos.push(...previous, ...point);
            previous = point;
          }
        }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    const mesh = new T.LineSegments(
      g,
      new T.LineBasicMaterial({
        color: index ? 0xd5e9d5 : 0xffe6a0,
        transparent: true,
        opacity: index ? 0.48 : 1,
        depthTest: false,
      }),
    );
    group.add(mesh);
  }
  return group;
}
export function landmarks(scene, terrain, atlas) {
  function mesh(geom, color, x, z, h, rotation = 0) {
    const m = new T.Mesh(geom, new T.MeshLambertMaterial({ color }));
    m.position.set(x, terrain.meters(x, z) * relief + h, z);
    m.rotation.y = rotation;
    scene.add(m);
  }
  // Stylized Anshun covered bridge and the distinctive TV tower east of the square.
  const bx = 7.96934,
    bz = 6.20493;
  const bridgeAxis = -Math.atan2(7981.28 - 7957.39, 6242.95 - 6166.9);
  mesh(
    new T.BoxGeometry(0.0168, 3.5 * relief, 0.0797),
    0xc0ab92,
    bx,
    bz,
    1.75 * relief,
    bridgeAxis,
  );
  mesh(new T.BoxGeometry(0.013, 6 * relief, 0.074), 0xaa7953, bx, bz, 6.5 * relief, bridgeAxis);
  mesh(
    new T.BoxGeometry(0.0156, 2.5 * relief, 0.076),
    0x674b3d,
    bx,
    bz,
    10.75 * relief,
    bridgeAxis,
  );
  const [tx, tz] = project([104.0918, 30.6652]);
  mesh(new T.CylinderGeometry(0.022, 0.045, 0.54, 10), 0xdacabe, tx, tz, 0.27);
  mesh(new T.SphereGeometry(0.088, 16, 10), 0xb4735e, tx, tz, 0.46);
  mesh(new T.ConeGeometry(0.017, 0.24, 8), 0xe8d1ba, tx, tz, 0.65);
  // Extrude the actual terminal outlines. Roof elevations and materials are illustrative.
  const roof = new T.MeshLambertMaterial({ color: 0xdce2df });
  const wall = new T.MeshLambertMaterial({ color: 0x65828b });
  for (const ring of atlas.terminals) {
    const coords = ring.map(project),
      [cx, cz] = coords[0];
    const outline = new T.Shape(coords.map(([x, z]) => new T.Vector2(x - cx, cz - z)));
    const g = new T.ExtrudeGeometry(outline, { depth: 0.074, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    const terminal = new T.Mesh(g, [roof, wall]);
    terminal.position.set(cx, terrain.meters(cx, cz) * relief + 0.008, cz);
    scene.add(terminal);
  }
  // A draped ribbon preserves runway axes and readable markings at low altitude.
  const stripe = document.createElement('canvas');
  stripe.width = 64;
  stripe.height = 512;
  const pen = stripe.getContext('2d');
  pen.fillStyle = '#61686a';
  pen.fillRect(0, 0, 64, 512);
  pen.fillStyle = '#eae7d8';
  pen.fillRect(2, 0, 1, 512);
  pen.fillRect(61, 0, 1, 512);
  for (let i = 15; i < 505; i += 16) pen.fillRect(31, i, 2, 8);
  for (let i = 8; i < 61; i += 6) {
    pen.fillRect(i, 4, 3, 11);
    pen.fillRect(i, 497, 3, 11);
  }
  const tex = new T.CanvasTexture(stripe);
  tex.colorSpace = T.SRGBColorSpace;
  tex.anisotropy = 4;
  const pavement = new T.MeshLambertMaterial({ map: tex, side: T.DoubleSide });
  for (const [a, b] of atlas.runways) {
    const [x, z] = project(a),
      [endX, endZ] = project(b),
      dx = endX - x,
      dz = endZ - z;
    const length = Math.hypot(dx, dz),
      sideX = (dz / length) * 0.066,
      sideZ = (-dx / length) * 0.066;
    const g = new T.PlaneGeometry(1, 1, 1, 24),
      p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const u = i % 2 === 0 ? -1 : 1,
        v = Math.floor(i / 2) / 24;
      const px = x + dx * v + u * sideX,
        pz = z + dz * v + u * sideZ;
      p.setXYZ(i, px, terrain.meters(px, pz) * relief + 0.008, pz);
    }
    g.computeVertexNormals();
    scene.add(new T.Mesh(g, pavement));
  }
}
