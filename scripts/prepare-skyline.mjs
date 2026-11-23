// Extract the distant skyline from the same metre-quantized outlines as street flight.
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { ShapeUtils, Vector2 } from 'three';
const root = new URL('../public/assets/streets-v1/', import.meta.url);
const { tiles } = JSON.parse(readFileSync(new URL('index.json', root)));
const packs = new Map(),
  chunks = [];
let count = 0;
for (const [key, [start, length]] of Object.entries(tiles)) {
  const [i, j] = key.split(',').map(Number),
    file = Math.floor(i / 8) + '_' + Math.floor(j / 8) + '.pack';
  if (!packs.has(file)) packs.set(file, readFileSync(new URL(file, root)));
  const rows = JSON.parse(gunzipSync(packs.get(file).subarray(start, start + length))),
    vertices = [];
  for (const [kind, , attr, rings] of rows) {
    if (kind !== 'b' || attr[0] < 30) continue;
    const loops = rings.map((r) => {
      const vs = [];
      for (let k = 0; k < r.length; k += 2) vs.push(new Vector2(r[k], r[k + 1]));
      return vs;
    });
    const faces = ShapeUtils.triangulateShape(loops[0], loops.slice(1)),
      vs = loops.flat(),
      h = attr[0];
    for (const [a, b, c] of faces) for (const id of [a, c, b]) vertices.push(vs[id].x, h, vs[id].y);
    for (const loop of loops)
      for (let k = 0; k < loop.length; k++) {
        const a = loop[k],
          b = loop[(k + 1) % loop.length];
        vertices.push(a.x, 0, a.y, b.x, 0, b.y, b.x, h, b.y, a.x, 0, a.y, b.x, h, b.y, a.x, h, a.y);
      }
    count++;
  }
  if (vertices.length)
    chunks.push(
      Buffer.from(new Int32Array([i, j, vertices.length]).buffer),
      Buffer.from(new Int16Array(vertices).buffer),
    );
}
writeFileSync(new URL('skyline.gzdata', root), gzipSync(Buffer.concat(chunks), { level: 9 }));
console.log(count, 'footprints');
