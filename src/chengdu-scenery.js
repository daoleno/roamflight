import * as T from 'three';
import { project, places } from './chengdu-geo.js';

export const relief = 2.2 / 1000;
const at = (name) => project(places[name].slice(2));
function randomSource() {
  let seed = 510100;
  return () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
}
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
export function buildings(terrain, image, runways) {
  const c = document.createElement('canvas');
  c.width = image.width;
  c.height = image.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const rgba = ctx.getImageData(0, 0, c.width, c.height).data;
  const rng = randomSource(),
    cells = new Map(),
    box = new T.BoxGeometry(1, 1, 1);
  // A single mipmapped facade atlas keeps windows legible near the plane and
  // lets distant blocks collapse to their average colour without extra draws.
  const panel = document.createElement('canvas');
  panel.width = 64;
  panel.height = 128;
  const paint = panel.getContext('2d');
  paint.fillStyle = '#ece8dc';
  paint.fillRect(0, 0, 64, 128);
  for (let floor = 0; floor < 12; floor++) {
    paint.fillStyle = floor % 4 === 0 ? '#96aeaf' : '#a9babc';
    for (let bay = 0; bay < 6; bay++) paint.fillRect(3 + bay * 10, 7 + floor * 10, 8, 6);
  }
  paint.fillStyle = '#e4e0d3';
  paint.fillRect(0, 0, 64, 5);
  const facade = new T.CanvasTexture(panel);
  facade.colorSpace = T.SRGBColorSpace;
  // Both horizontal box faces sample the plain parapet strip.
  const uv = box.attributes.uv;
  for (let i = 8; i < 16; i++) uv.setXY(i, 0.5, 0.985);
  const materials = new T.MeshLambertMaterial({ map: facade });
  const { left, right, top, bottom } = terrain,
    [cx, cz] = at('square');
  const run = runways.map(([a, b]) => [...project(a), ...project(b)]);
  const dummy = new T.Object3D(),
    tint = new T.Color(),
    group = new T.Group();
  for (let row = 0; row < c.height; row += 2)
    for (let col = 0; col < c.width; col += 2) {
      const fraction = rgba[(row * c.width + col) * 4] / 255;
      if (fraction < 0.42 || rng() > fraction) continue;
      const x = left + ((col + 0.5) / c.width) * (right - left),
        z = top + ((row + 0.5) / c.height) * (bottom - top);
      // Keep clusters off airport manoeuvring areas.
      if (
        run.some(([a, b, d, e]) => {
          const u = Math.max(
            0,
            Math.min(1, ((x - a) * (d - a) + (z - b) * (e - b)) / ((d - a) ** 2 + (e - b) ** 2)),
          );
          return Math.hypot(x - a - u * (d - a), z - b - u * (e - b)) < 0.48;
        })
      )
        continue;
      const tile = Math.floor(x / 12) + ',' + Math.floor(z / 12);
      if (!cells.has(tile)) cells.set(tile, []);
      const density = Math.exp(-Math.hypot(x - cx, z - cz) / 6),
        angle = Math.round(Math.sin(x * 0.14 + z * 0.21) * 3) * 0.18;
      for (let k = 0; k < 3; k++) {
        const px = x + (k - 1) * 0.115,
          pz = z + (rng() - 0.5) * 0.19;
        const h = 0.045 + rng() ** 1.55 * (0.14 + density * 0.44);
        dummy.position.set(px, terrain.meters(px, pz) * relief + h / 2 - 0.008, pz);
        dummy.scale.set(0.052 + rng() * 0.05, h, 0.078 + rng() * 0.11);
        dummy.rotation.y = angle;
        dummy.updateMatrix();
        tint.setHex([0xc9c9bc, 0xacbfc0, 0xcbbca7, 0xdfdac8, 0x91a7aa][Math.floor(rng() * 5)]);
        cells.get(tile).push([dummy.matrix.clone(), tint.clone()]);
      }
    }
  for (const blocks of cells.values()) {
    const mesh = new T.InstancedMesh(box, materials, blocks.length);
    blocks.forEach(([matrix, color], i) => {
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, color);
    });
    mesh.computeBoundingSphere();
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
  const [bx, bz] = at('bridge');
  mesh(new T.BoxGeometry(0.26, 0.045, 0.072), 0xe2c79f, bx, bz, 0.065, -0.6);
  mesh(new T.CylinderGeometry(0.051, 0.088, 0.042, 4), 0xa94c36, bx, bz, 0.11, -0.6);
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
export function cloudField(terrain) {
  const rng = randomSource();
  const mesh = new T.InstancedMesh(
    new T.IcosahedronGeometry(1, 0),
    new T.MeshLambertMaterial({ color: 0xfff9e9, flatShading: true }),
    120,
  );
  const dummy = new T.Object3D();
  for (let i = 0; i < 40; i++) {
    const x = terrain.left + rng() * (terrain.right - terrain.left),
      z = terrain.top + rng() * (terrain.bottom - terrain.top);
    const y = terrain.meters(x, z) * relief + 4 + rng() * 3;
    for (let j = 0; j < 3; j++) {
      dummy.position.set(x + j * 0.84, y + rng() * 0.22, z + rng());
      dummy.scale.set(1 + rng(), 0.24 + rng() * 0.36, 0.7 + rng());
      dummy.updateMatrix();
      mesh.setMatrixAt(i * 3 + j, dummy.matrix);
    }
  }
  return mesh;
}
