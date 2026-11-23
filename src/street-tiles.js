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
async function makeTile(i, j, size, records, ground, imagery, environment, yieldFrame) {
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
  const { terrain, regionalImage, wave, time } = environment;
  const image = regionalImage.image;
  const sx = image.width / ((terrain.right - terrain.left) * 1000),
    sz = image.height / ((terrain.bottom - terrain.top) * 1000);
  if (imagery)
    ctx.drawImage(imagery, ox / 10, (oz + 1200) / 10, size / 10, size / 10, 0, 0, size, size);
  else
    ctx.drawImage(
      image,
      (ox - terrain.left * 1000) * sx,
      (oz - terrain.top * 1000) * sz,
      size * sx,
      size * sz,
      0,
      0,
      size,
      size,
    );
  // Retain the satellite variation underneath mapped surfaces and use separate chart ink.
  const pavement = {
    path: '#b6a993',
    street: '#5e6467',
    main: '#606368',
    motor: '#53585d',
    bridge: '#928b80',
  };
  for (const type of order)
    for (const [kind, , width, rings] of records) {
      if (type !== kind || kind === 'water' || kind === 'river') continue;
      trace(ctx, rings, kind in land);
      if (kind in land) {
        ctx.globalAlpha = kind === 'deck' ? 0.88 : kind === 'plaza' ? 0.23 : 0.17;
        ctx.fillStyle = kind === 'green' ? '#566e42' : land[kind];
        ctx.fill('evenodd');
      } else {
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = pavement[kind];
        ctx.lineWidth = width;
        ctx.stroke();
        if ((kind === 'main' || kind === 'motor') && width >= 8) {
          ctx.globalAlpha = 0.56;
          ctx.lineWidth = 0.48;
          ctx.strokeStyle = '#cec6a2';
          ctx.stroke();
        }
      }
    }
  ctx.globalAlpha = 1;
  const landscape = environment.landscape[i + ',' + j] || [];
  const trees = [];
  function canopy(x, z) {
    if (x >= 0 && x < size && z >= 0 && z < size) trees.push([x, z]);
  }
  for (const [kind, path] of landscape) {
    if (kind === 'tree') {
      canopy(...path);
      continue;
    }
    if (kind === 'tree_row') {
      let offset = 0;
      for (let k = 2; k < path.length; k += 2) {
        const dx = path[k] - path[k - 2],
          dz = path[k + 1] - path[k - 1],
          length = Math.hypot(dx, dz);
        for (; offset < length; offset += 8)
          canopy(path[k - 2] + (dx * offset) / length, path[k - 1] + (dz * offset) / length);
        offset -= length;
      }
      continue;
    }
    trace(ctx, [path], false);
    ctx.lineWidth = 1.4;
    if (kind === 'hedge' || kind === 'track') {
      ctx.strokeStyle = kind === 'hedge' ? '#476044' : '#aa7862';
      ctx.stroke();
      continue;
    }
    ctx.fillStyle = {
      pitch: '#668565',
      fountain: '#65999c',
      swimming_pool: '#5d9cac',
      grass: '#75905f',
      flowerbed: '#827f57',
    }[kind];
    ctx.globalAlpha = 0.65;
    ctx.fill();
    if (kind === 'pitch' || kind === 'fountain') {
      ctx.strokeStyle = '#d1d2b8';
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  let foliage;
  if (trees.length) {
    foliage = new T.InstancedMesh(
      new T.IcosahedronGeometry(1, 1),
      new T.MeshLambertMaterial({ color: 0x69834d }),
      trees.length,
    );
    const crown = new T.Object3D();
    for (const [index, [x, z]] of trees.entries()) {
      const radius = 2.6 + Math.abs((x + z) % 11) * 0.11;
      crown.position.set(x, ground(ox + x, oz + z) + radius + 1.8, z);
      crown.scale.set(radius, radius * 1.14, radius);
      crown.rotation.y = x;
      crown.updateMatrix();
      foliage.setMatrixAt(index, crown.matrix);
    }
    foliage.castShadow = foliage.receiveShadow = true;
    group.add(foliage);
  }
  let waterMap;
  if (records.some(([k]) => k === 'water' || k === 'river')) {
    // Green denotes mapped water, red its bank. Omit artificial clipping edges at tile borders.
    const mask = document.createElement('canvas');
    mask.width = mask.height = 512;
    const m = mask.getContext('2d');
    m.scale(512 / size, 512 / size);
    m.fillStyle = 'black';
    m.fillRect(0, 0, size, size);
    for (const [kind, , width, rings] of records) {
      if (kind !== 'water' && kind !== 'river') continue;
      trace(m, rings, kind === 'water');
      m.fillStyle = m.strokeStyle = '#00ff00';
      if (kind === 'river') {
        m.lineWidth = width;
        m.stroke();
        continue;
      }
      m.fill('evenodd');
      m.save();
      m.clip('evenodd');
      m.beginPath();
      for (const ring of rings)
        for (let k = 0; k < ring.length; k += 2) {
          const n = (k + 2) % ring.length;
          if (
            [0, size].some(
              (edge) =>
                (Math.abs(ring[k] - edge) < 1 && Math.abs(ring[n] - edge) < 1) ||
                (Math.abs(ring[k + 1] - edge) < 1 && Math.abs(ring[n + 1] - edge) < 1),
            )
          )
            continue;
          m.moveTo(ring[k], ring[k + 1]);
          m.lineTo(ring[n], ring[n + 1]);
        }
      for (const [w, color] of [
        [16, '#40ff00'],
        [8, '#80ff00'],
        [3, '#c0ff00'],
      ]) {
        m.lineWidth = w;
        m.strokeStyle = color;
        m.stroke();
      }
      m.restore();
    }
    for (const [kind, , width, rings] of records)
      if (kind === 'deck' || kind === 'bridge') {
        trace(m, rings, kind === 'deck');
        m.fillStyle = m.strokeStyle = 'black';
        m.lineWidth = width;
        if (kind === 'deck') m.fill('evenodd');
        else m.stroke();
      }
    waterMap = new T.CanvasTexture(mask);
  }
  const groundGeom = new T.PlaneGeometry(size, size, 8, 8);
  groundGeom.rotateX(-Math.PI / 2);
  groundGeom.translate(size / 2, 0, size / 2);
  const pos = groundGeom.attributes.position;
  for (let k = 0; k < pos.count; k++)
    pos.setY(k, ground(ox + pos.getX(k), oz + pos.getZ(k)) + 0.35);
  groundGeom.computeVertexNormals();
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 4;
  const floor = new T.Mesh(
    groundGeom,
    new T.MeshLambertMaterial({ map: texture, polygonOffset: true, polygonOffsetFactor: -2 }),
  );
  floor.receiveShadow = true;
  if (waterMap)
    floor.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, {
        riverMask: { value: waterMap },
        waves: { value: wave },
        flightTime: time,
      });
      shader.vertexShader =
        'varying vec3 groundWorld;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\ngroundWorld=(modelMatrix*vec4(position,1.)).xyz;',
        );
      shader.fragmentShader =
        'varying vec3 groundWorld;uniform sampler2D riverMask,waves;uniform float flightTime;\n' +
        shader.fragmentShader.replace(
          '#include <map_fragment>',
          `#include <map_fragment>
      vec2 bank=texture2D(riverMask,vMapUv).rg;
      if(bank.g>.01){
        vec2 uv=groundWorld.xz;
        vec2 ripple=(texture2D(waves,uv/38.+flightTime*.006).rg+texture2D(waves,uv/21.-flightTime*.004).rg-1.);
        vec3 viewDir=normalize(cameraPosition-groundWorld);
        float fresnel=pow(1.-clamp(viewDir.y,0.,1.),3.);
        vec3 normal=normalize(vec3(ripple.x*.12,1.,ripple.y*.12));
        float glint=pow(max(dot(normal,normalize(viewDir+normalize(vec3(-.84,.88,.38)))),0.),60.);
        vec3 river=mix(vec3(.026,.122,.133),vec3(.081,.208,.185),bank.r);
        river=mix(river,vec3(.19,.34,.48),fresnel*.52)+ripple.x*.016+vec3(.63,.59,.46)*glint;
        diffuseColor.rgb=mix(diffuseColor.rgb,river,bank.g);
      }`,
        );
    };
  group.add(floor);
  const coords = [],
    colors = [],
    facade = [],
    hulls = [],
    labels = [];
  let faceHeight = 0,
    baseY = 0,
    style = 0,
    bay = 4;
  function tri(p, q, r, c, uvs) {
    coords.push(...p, ...q, ...r);
    for (const [index, vertex] of [p, q, r].entries())
      facade.push(uvs ? uvs[index] / bay : 0, vertex[1] - baseY, uvs ? faceHeight : 0, style);
    for (let i = 0; i < 3; i++) colors.push(c.r, c.g, c.b);
  }
  const roof = new T.Color(),
    wall = new T.Color();
  // Storey marks are a visual scale cue. Only the outline and sourced / estimated height carry location-specific information.
  let deadline = performance.now() + 4;
  for (const [kind, name, attr, rings] of records) {
    if (performance.now() > deadline) {
      await yieldFrame();
      deadline = performance.now() + 4;
    }
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
    const seed = Math.abs(
      Math.imul(Math.round(ox + xmin), 31) ^ Math.imul(Math.round(oz + zmin), 97),
    );
    style = bridge || museum ? 0 : h <= 12 ? 1 : h < 48 ? 2 : 3 + (seed % 2);
    bay = style === 1 ? 3.6 : style === 2 ? 4.2 : 2.9 + (seed % 4) * 0.32;
    faceHeight = h;
    baseY = base;
    roof.setHex(
      bridge ? 0x674b3d : museum ? 0x998568 : [0xa5a6a0, 0x949c9c, 0xb5b1a5, 0xaca49a][seed % 4],
    );
    wall.setHex(
      bridge
        ? 0xaa7953
        : museum
          ? 0xae9065
          : style >= 3
            ? [0x9eafb1, 0x97a6a8, 0xb3b7af][seed % 3]
            : [0xc9bfb0, 0xb9b8ad, 0xc9cbbe, 0xb9afa4][seed % 4],
    );
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
        // Open gallery bays sit inside the existing documented illustrative envelope.
        for (let along = -36; along <= 36; along += 6) {
          quad(
            at(along - 0.42, side * 6.5, 3.5),
            at(along + 0.42, side * 6.5, 3.5),
            at(along + 0.42, side * 6.5, 9.5),
            at(along - 0.42, side * 6.5, 9.5),
            wall,
          );
        }
        quad(
          at(-37, side * 6.5, 3.5),
          at(37, side * 6.5, 3.5),
          at(37, side * 6.5, 4.5),
          at(-37, side * 6.5, 4.5),
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
        const length = a.distanceTo(b);
        tri(p, q, r, wall, [0, length, length]);
        tri(p, r, s, wall, [0, length, 0]);
      }
    if (!bridge) {
      trace(ctx, rings, true);
      ctx.save();
      ctx.clip('evenodd');
      ctx.strokeStyle = 'rgba(64,61,55,.75)';
      ctx.lineWidth = 3.3;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(226,223,208,.95)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }
    // Also draw roofprints on the flat navigation chart.
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.Float32BufferAttribute(coords, 3));
  geo.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const material = new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide });
  geo.setAttribute('facade', new T.Float32BufferAttribute(facade, 4));
  material.onBeforeCompile = (shader) => {
    shader.uniforms.groundColour = { value: texture };
    shader.uniforms.tileSize = { value: size };
    shader.vertexShader =
      'attribute vec4 facade; varying vec4 vFacade; varying vec2 roofUv; uniform float tileSize;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvFacade=facade;roofUv=vec2(position.x/tileSize,1.-position.z/tileSize);',
      );
    shader.fragmentShader =
      'varying vec4 vFacade; varying vec2 roofUv; uniform sampler2D groundColour;\n' +
      shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
      if(vFacade.z==0. && vFacade.w>0.){
        vec3 image=texture2D(groundColour,roofUv).rgb;
        diffuseColor.rgb=diffuseColor.rgb*.64+image*.43;
      }else if(vFacade.z>0.){
        float y=vFacade.y,h=vFacade.z,style=vFacade.w;
        vec2 cell=vec2(vFacade.x,y/(style>2.5?3.8:3.2));
        vec2 d=max(fwidth(cell),vec2(.012));
        vec2 f=fract(cell);float fade=1.-smoothstep(.14,.66,max(d.x,d.y));
        float span=style>2.5?.45:(style>1.5?.35:.26);
        float pane=(1.-smoothstep(span-d.x,span+d.x,abs(f.x-.5)))*
          (1.-smoothstep(.31-d.y,.31+d.y,abs(f.y-.54)));
        if(style==4.)pane=1.-smoothstep(.39-d.y,.39+d.y,abs(f.y-.55));
        float glass=mix(span*.99,pane,fade)*step(.5,style)*smoothstep(.5,2.8,y)*(1.-smoothstep(h-1.3,h-.45,y));
        vec3 reflection=mix(vec3(.22,.31,.36),vec3(.52,.68,.75),smoothstep(0.,h,y));
        float vertical=1.-smoothstep(.06,.12,abs(fract(cell.x*.20)-.5));
        if(style>2.5)glass*=1.-.62*vertical*fade;
        diffuseColor.rgb*=mix(vec3(1.),reflection,glass);
        diffuseColor.rgb*=mix(.68,1.,smoothstep(0.,min(12.,h*.45),y));
        diffuseColor.rgb*=1.-.12*(1.-smoothstep(.1,.52,abs(h-y-.8)))*fade;
      }`,
      );
  };
  const buildings = new T.Mesh(geo, material);
  buildings.castShadow = buildings.receiveShadow = true;
  group.add(buildings);
  let chartCanvas;
  function drawChart() {
    const chart = document.createElement('canvas');
    chart.width = chart.height = 640;
    const ink = chart.getContext('2d');
    ink.scale(640 / size, 640 / size);
    ink.fillStyle = '#e1e2d5';
    ink.fillRect(0, 0, size, size);
    paintLayers(ink);
    for (const h of hulls) {
      trace(ink, h.rings, true);
      ink.fillStyle = '#a89d8b';
      ink.fill('evenodd');
      ink.lineWidth = 1.2;
      ink.strokeStyle = '#918a7c';
      ink.stroke();
    }
    chartCanvas = chart;
  }
  const bucketSize = 100;
  const footprints = new Map();
  for (const h of hulls) {
    for (let col = Math.floor(h.xmin / bucketSize); col <= Math.floor(h.xmax / bucketSize); col++)
      for (
        let row = Math.floor(h.zmin / bucketSize);
        row <= Math.floor(h.zmax / bucketSize);
        row++
      ) {
        const key = col + ',' + row;
        if (!footprints.has(key)) footprints.set(key, []);
        footprints.get(key).push(h);
      }
  }
  return {
    group,
    get chart() {
      if (!chartCanvas) drawChart();
      return chartCanvas;
    },
    ox,
    oz,
    labels,
    hulls,
    records: records.length,
    buildingAt(x, z) {
      let result;
      const u = x - ox,
        v = z - oz;
      const bucket = footprints.get(Math.floor(u / bucketSize) + ',' + Math.floor(v / bucketSize));
      if (!bucket) return;
      for (const h of bucket) {
        if (u < h.xmin - 5 || u > h.xmax + 5 || v < h.zmin - 5 || v > h.zmax + 5) continue;
        if (inside(u, v, h.rings[0]) && !h.rings.slice(1).some((r) => inside(u, v, r)))
          if (!result || h.top > result.top) result = h;
      }
      return result;
    },
    dispose() {
      group.removeFromParent();
      if (foliage) {
        foliage.geometry.dispose();
        foliage.material.dispose();
        foliage.dispose();
      }
      waterMap?.dispose();
      texture.dispose();
      groundGeom.dispose();
      floor.material.dispose();
      geo.dispose();
      material.dispose();
      canvas.width = 1;
      if (chartCanvas) chartCanvas.width = 1;
    },
  };
}
export function streetTiles(scene, index, ground, environment) {
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
  let buildQueue = Promise.resolve();
  async function load(key) {
    const entry = index.tiles[key];
    if (!entry) return;
    const [i, j] = key.split(',').map(Number),
      [start, length] = entry,
      ctl = new AbortController();
    pending.set(key, ctl);
    try {
      const response = await fetch(
        streetRoot + Math.floor(i / 8) + '_' + Math.floor(j / 8) + '.pack?districts=2',
        { headers: { Range: 'bytes=' + start + '-' + (start + length - 1) }, signal: ctl.signal },
      );
      if (!response.ok) throw Error('Street tile ' + response.status);
      let data = await response.arrayBuffer();
      bytes += data.byteLength;
      if (response.status !== 206) data = data.slice(start, start + length);
      if (!wanted.has(key)) return;
      const img = await groundImage(i, j);
      const yieldFrame = async () => {
        await new Promise(requestAnimationFrame);
        ctl.signal.throwIfAborted();
      };
      // Serialize CPU work even when several byte ranges arrive in the same network batch.
      const build = buildQueue.then(async () => {
        await yieldFrame();
        return makeTile(i, j, size, decodeGzip(data), ground, img, environment, yieldFrame);
      });
      buildQueue = build.catch(() => {});
      const tile = await build;
      if (!wanted.has(key)) {
        tile.dispose();
        return;
      }
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
