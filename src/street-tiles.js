import * as T from 'three';
import { gunzipSync, strFromU8 } from 'three/addons/libs/fflate.module.js';
export const streetRoot = '/assets/streets-v1/';
export const decodeGzip = (data) => JSON.parse(strFromU8(gunzipSync(new Uint8Array(data))));
const land = { green: '#92ac81', water: '#608f9c', plaza: '#dbceb5', deck: '#c5b9a7' };
const streets = {
  river: '#64929d',
  path: '#d6cbb7',
  street: '#afb5ae',
  main: '#a2aaa7',
  motor: '#a3aaa8',
  bridge: '#c4b4a2',
};
const order = [
  'green',
  'plaza',
  'water',
  'river',
  'path',
  'street',
  'main',
  'motor',
  'deck',
  'bridge',
];
function trace(ctx, rings, close) {
  ctx.beginPath();
  for (const ring of rings) {
    ctx.moveTo(ring[0], ring[1]);
    for (let k = 2; k < ring.length; k += 2) ctx.lineTo(ring[k], ring[k + 1]);
    if (close) ctx.closePath();
  }
}
function inside(x, z, r) {
  let hit = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    if (
      r[i + 1] > z !== r[j + 1] > z &&
      x < ((r[j] - r[i]) * (z - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]
    )
      hit = !hit;
  }
  return hit;
}
function makeTile(i, j, size, records, ground, imagery) {
  const ox = i * size,
    oz = j * size,
    group = new T.Group();
  group.position.set(ox, 0, oz);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 768;
  const ctx = canvas.getContext('2d');
  ctx.scale(canvas.width / size, canvas.height / size);
  ctx.fillStyle = '#bec3ad';
  ctx.fillRect(0, 0, size, size);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  function paintLayers(ctx) {
    for (const type of order)
      for (const [kind, , width, rings] of records) {
        if (type !== kind) continue;
        trace(ctx, rings, kind in land);
        if (kind in land) {
          ctx.fillStyle = land[kind];
          ctx.fill('evenodd');
        } else {
          ctx.strokeStyle = streets[kind];
          ctx.lineWidth = width;
          ctx.stroke();
          if (['motor', 'main'].includes(kind) && width > 6) {
            ctx.strokeStyle = '#e6d9aa';
            ctx.setLineDash([5, 5]);
            ctx.lineWidth = 0.9;
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
      }
  }
  const chart = document.createElement('canvas');
  chart.width = chart.height = 640;
  const ink = chart.getContext('2d');
  ink.scale(640 / size, 640 / size);
  ink.fillStyle = '#e1e2d5';
  ink.fillRect(0, 0, size, size);
  paintLayers(ink);
  if (imagery) {
    ctx.globalAlpha = 0.7;
    ctx.drawImage(imagery, ox / 10, (oz + 1200) / 10, size / 10, size / 10, 0, 0, size, size);
    // The RGB image provides ground colour. Mapped road and water geometry stays legible over it.
    ctx.globalAlpha = 0.83;
  }
  paintLayers(ctx);
  ctx.globalAlpha = 1;
  const groundGeom = new T.PlaneGeometry(size, size, 8, 8);
  groundGeom.rotateX(-Math.PI / 2);
  groundGeom.translate(size / 2, 0, size / 2);
  const pos = groundGeom.attributes.position;
  for (let k = 0; k < pos.count; k++)
    pos.setY(k, ground(ox + pos.getX(k), oz + pos.getZ(k)) + 0.35);
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 4;
  const floor = new T.Mesh(
    groundGeom,
    new T.MeshBasicMaterial({ map: texture, polygonOffset: true, polygonOffsetFactor: -2 }),
  );
  group.add(floor);
  const coords = [],
    colors = [],
    hulls = [],
    labels = [];
  function tri(p, q, r, c) {
    coords.push(...p, ...q, ...r);
    for (let i = 0; i < 3; i++) colors.push(c.r, c.g, c.b);
  }
  const roof = new T.Color(),
    wall = new T.Color();
  // Storey marks are a visual scale cue. Only the outline and sourced / estimated height carry location-specific information.
  for (const [kind, name, attr, rings] of records) {
    if (kind === 'p') {
      labels.push({
        name,
        category: attr[0],
        district: attr[1],
        source: attr[2],
        x: ox + rings[0][0],
        z: oz + rings[0][1],
      });
      continue;
    }
    if (kind !== 'b' && !(kind === 'deck' && name === '安顺廊桥')) continue;
    const bridge = kind === 'deck',
      h = bridge ? 12 : attr[0];
    const outline = rings[0];
    if (outline.length < 6) continue;
    const vectors = rings.map((r) => {
      const vs = [];
      for (let n = 0; n < r.length; n += 2) vs.push(new T.Vector2(r[n], r[n + 1]));
      return vs;
    });
    const vs = vectors.flat(),
      base = ground(ox + outline[0], oz + outline[1]) + 0.48;
    const xmin = Math.min(...vectors[0].map((v) => v.x)),
      xmax = Math.max(...vectors[0].map((v) => v.x));
    const zmin = Math.min(...vectors[0].map((v) => v.y)),
      zmax = Math.max(...vectors[0].map((v) => v.y));
    hulls.push({
      xmin,
      xmax,
      zmin,
      zmax,
      rings,
      height: h,
      mode: bridge ? 4 : attr[1],
      top: base + h,
    });
    const museum = ox + xmin < 5844 && ox + xmax > 5844 && oz + zmin < 4485 && oz + zmax > 4485;
    roof.setHex(bridge ? 0x805741 : museum ? 0xb59865 : h > 55 ? 0xa9b8b8 : 0xc2baab);
    wall.setHex(bridge ? 0xb08b67 : museum ? 0xb49a71 : h > 55 ? 0x98aeb1 : 0xd9d1bf);
    // The mapped Anshun deck supports a two-storey covered gallery. Dimensions above the deck are illustrative.
    const deckTop = bridge ? 3.5 : h;
    if (bridge) {
      const theta = Math.atan2(7981.28 - 7957.39, 6242.95 - 6166.9);
      const at = (along, across, height) => [
        7969.34 - ox + along * Math.sin(theta) + across * Math.cos(theta),
        base + height,
        6204.93 - oz - along * Math.cos(theta) + across * Math.sin(theta),
      ];
      const quad = (a, b, c, d, color) => {
        tri(a, b, c, color);
        tri(a, c, d, color);
      };
      for (const side of [-1, 1]) {
        quad(
          at(-37, side * 6.5, 3.5),
          at(37, side * 6.5, 3.5),
          at(37, side * 6.5, 9.5),
          at(-37, side * 6.5, 9.5),
          wall,
        );
        for (const [eave, ridge, width] of [
          [7, 9, 8.5],
          [9.4, 12, 7.8],
        ]) {
          quad(
            at(-38, side * width, eave),
            at(38, side * width, eave),
            at(35, 0, ridge),
            at(-35, 0, ridge),
            roof,
          );
        }
        quad(
          at(side * 37, -6.5, 3.5),
          at(side * 37, 6.5, 3.5),
          at(side * 37, 6.5, 9.5),
          at(side * 37, -6.5, 9.5),
          wall,
        );
      }
    }
    for (const [a, b, c] of T.ShapeUtils.triangulateShape(vectors[0], vectors.slice(1))) {
      tri(...[a, c, b].map((k) => [vs[k].x, base + deckTop, vs[k].y]), roof);
    }
    for (const ring of vectors)
      for (let k = 0; k < ring.length; k++) {
        const a = ring[k],
          b = ring[(k + 1) % ring.length];
        const p = [a.x, base, a.y],
          q = [b.x, base, b.y],
          r = [b.x, base + deckTop, b.y],
          s = [a.x, base + deckTop, a.y];
        tri(p, q, r, wall);
        tri(p, r, s, wall);
      }
    // Also draw roofprints on the flat navigation chart.
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.Float32BufferAttribute(coords, 3));
  geo.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const material = new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader =
      'varying vec3 streetPosition;varying float streetWall;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nstreetPosition=position;streetWall=1.-abs(normal.y);',
      );
    shader.fragmentShader =
      'varying vec3 streetPosition;varying float streetWall;\n' +
      shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  vec2 panel=vec2((streetPosition.x+streetPosition.z)*.28,streetPosition.y*.30);
  float fade=1.-smoothstep(.15,.65,max(fwidth(panel.x),fwidth(panel.y)));
  float glass=smoothstep(.14,.26,fract(panel.x))*(1.-smoothstep(.78,.92,fract(panel.x)))*smoothstep(.25,.38,fract(panel.y))*(1.-smoothstep(.74,.89,fract(panel.y)));
  diffuseColor.rgb*=mix(vec3(1.),vec3(.66,.77,.79),glass*fade*streetWall);`,
      );
  };
  group.add(new T.Mesh(geo, material));
  for (const h of hulls) {
    trace(ink, h.rings, true);
    ink.fillStyle = '#a89d8b';
    ink.fill('evenodd');
    ink.lineWidth = 1.2;
    ink.strokeStyle = '#918a7c';
    ink.stroke();
  }
  return {
    group,
    chart,
    ox,
    oz,
    labels,
    hulls,
    records: records.length,
    buildingAt(x, z) {
      let result;
      const u = x - ox,
        v = z - oz;
      for (const h of hulls) {
        if (u < h.xmin - 5 || u > h.xmax + 5 || v < h.zmin - 5 || v > h.zmax + 5) continue;
        if (inside(u, v, h.rings[0]) && !h.rings.slice(1).some((r) => inside(u, v, r)))
          if (!result || h.top > result.top) result = h;
      }
      return result;
    },
    dispose() {
      group.removeFromParent();
      texture.dispose();
      groundGeom.dispose();
      floor.material.dispose();
      geo.dispose();
      material.dispose();
      canvas.width = chart.width = 1;
    },
  };
}
export function streetTiles(scene, index, ground) {
  const size = index.size,
    tiles = new Map(),
    pending = new Map(),
    failures = new Map();
  let wanted = new Set(),
    generation = 0;
  let bytes = 0,
    loaded = 0,
    peak = 0;
  let imagery;
  function groundImage(i, j) {
    if (i < 0 || i >= 10 || j < -1 || j >= 9) return null;
    if (!imagery) {
      const img = new Image();
      img.src = streetRoot + 'chengdu-rgb.webp';
      imagery = img
        .decode()
        .then(() => img)
        .catch(() => null);
    }
    return imagery;
  }
  async function load(key) {
    const entry = index.tiles[key];
    if (!entry) return;
    const [i, j] = key.split(',').map(Number),
      [start, length] = entry,
      ctl = new AbortController();
    pending.set(key, ctl);
    try {
      const response = await fetch(
        streetRoot + Math.floor(i / 8) + '_' + Math.floor(j / 8) + '.pack',
        { headers: { Range: 'bytes=' + start + '-' + (start + length - 1) }, signal: ctl.signal },
      );
      if (!response.ok) throw Error('Street tile ' + response.status);
      let data = await response.arrayBuffer();
      bytes += data.byteLength;
      if (response.status !== 206) data = data.slice(start, start + length);
      if (!wanted.has(key)) return;
      const records = decodeGzip(data);
      await new Promise(requestAnimationFrame);
      if (!wanted.has(key)) return;
      const img = await groundImage(i, j);
      if (!wanted.has(key)) return;
      const tile = makeTile(i, j, size, records, ground, img);
      tiles.set(key, tile);
      scene.add(tile.group);
      failures.delete(key);
      loaded++;
      peak = Math.max(peak, tiles.size);
      generation++;
    } catch (err) {
      if (err.name !== 'AbortError') failures.set(key, Date.now());
    } finally {
      pending.delete(key);
    }
  }
  function update(x, z, radius = 1) {
    const i = Math.floor(x / size),
      j = Math.floor(z / size),
      keys = [];
    for (let a = -radius; a <= radius; a++)
      for (let b = -radius; b <= radius; b++) keys.push([i + a + ',' + (j + b), a * a + b * b]);
    keys.sort((a, b) => a[1] - b[1]);
    wanted = new Set(keys.map((v) => v[0]));
    for (const [k, t] of tiles)
      if (!wanted.has(k)) {
        t.dispose();
        tiles.delete(k);
        generation++;
      }
    for (const [k, c] of pending) if (!wanted.has(k)) c.abort();
    for (const [k] of keys) {
      if (pending.size >= 3) break;
      if (
        index.tiles[k] &&
        !tiles.has(k) &&
        !pending.has(k) &&
        Date.now() - (failures.get(k) || 0) > 3000
      )
        load(k);
    }
  }
  function buildingAt(x, z) {
    let highest;
    for (const t of tiles.values()) {
      if (x < t.ox - 300 || x > t.ox + size + 300 || z < t.oz - 300 || z > t.oz + size + 300)
        continue;
      const h = t.buildingAt(x, z);
      if (h && (!highest || h.top > highest.top)) highest = h;
    }
    return highest;
  }
  return {
    tiles,
    update,
    size,
    get generation() {
      return generation;
    },
    buildingAt,
    roof(x, z) {
      return buildingAt(x, z)?.top || 0;
    },
    readyAt(x, z) {
      const key = Math.floor(x / size) + ',' + Math.floor(z / size);
      return !index.tiles[key] || tiles.has(key);
    },
    stats() {
      return {
        loaded,
        active: tiles.size,
        peak,
        bytes,
        pending: pending.size,
        failed: failures.size,
        keys: [...tiles.keys()],
      };
    },
  };
}
