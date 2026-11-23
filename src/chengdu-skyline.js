import * as T from 'three';
import { gunzipSync } from 'three/addons/libs/fflate.module.js';

// Keep the compressed city's metre coordinates. Expand only chunks within the view distance.
export async function loadSkyline(ground, unitsPerMetre, verticalScale) {
  const response = await fetch('/assets/streets-v1/skyline.gzdata');
  if (!response.ok) throw Error('Skyline ' + response.status);
  const bytes = gunzipSync(new Uint8Array(await response.arrayBuffer()));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const cells = [],
    group = new T.Group();
  const material = new T.MeshLambertMaterial({ color: 0xb0bab8, side: T.DoubleSide });
  for (let offset = 0; offset < bytes.length;) {
    const i = view.getInt32(offset, true),
      j = view.getInt32(offset + 4, true),
      length = view.getInt32(offset + 8, true);
    offset += 12;
    cells.push({
      i,
      j,
      key: i + ',' + j,
      raw: new Int16Array(bytes.buffer, bytes.byteOffset + offset, length),
      mesh: null,
    });
    offset += length * 2;
  }
  let anchorX = Infinity,
    anchorZ = Infinity,
    lastGeneration = -1;
  return {
    group,
    update(x, z, radius, nearTiles, generation = 0) {
      if (lastGeneration === generation && Math.hypot(x - anchorX, z - anchorZ) < radius * 0.04)
        return;
      anchorX = x;
      anchorZ = z;
      lastGeneration = generation;
      for (const cell of cells) {
        const { i, j, raw } = cell;
        const visible =
          Math.hypot((i + 0.5) * 1200 - x, (j + 0.5) * 1200 - z) < radius &&
          !nearTiles?.has(cell.key);
        if (visible && !cell.mesh) {
          const pos = new Float32Array(raw.length);
          for (let k = 0; k < pos.length; k += 3) {
            const mx = i * 1200 + raw[k],
              mz = j * 1200 + raw[k + 2];
            pos[k] = mx * unitsPerMetre;
            pos[k + 1] = (ground(mx, mz) + raw[k + 1]) * verticalScale;
            pos[k + 2] = mz * unitsPerMetre;
          }
          const geo = new T.BufferGeometry();
          geo.setAttribute('position', new T.BufferAttribute(pos, 3));
          geo.computeVertexNormals();
          geo.computeBoundingSphere();
          cell.mesh = new T.Mesh(geo, material);
          group.add(cell.mesh);
        } else if (cell.mesh && !visible) {
          group.remove(cell.mesh);
          cell.mesh.geometry.dispose();
          cell.mesh = null;
        }
      }
    },
  };
}
