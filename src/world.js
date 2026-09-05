import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { mergeGeometries, mergeGroups } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { RADIUS, toPoint } from './geo.js';
import { preparePropeller } from './aircraft.js';
import { prepareControlSurfaces } from './control-surfaces.js';

const asset = (name) => `/assets/${name}`;
const sharedVertex = `
  varying vec3 vWorld; varying vec3 vNormal;
  void main() {
    vWorld = (modelMatrix * vec4(position, 1.)).xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.);
  }`;
const geographic = `
  const float PI = 3.14159265359;
  vec2 geoUV(vec3 p) { p = normalize(p); return vec2(atan(p.x, p.z) / (2. * PI) + .5, asin(clamp(p.y,-1.,1.)) / PI + .5); }
`;

export async function createWorld(renderer, scene, onProgress) {
  const loader = new THREE.TextureLoader();
  let loaded = 0;
  async function texture(name, srgb = false) {
    const t = await loader.loadAsync(asset(name));
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    onProgress(++loaded * 8);
    return t;
  }
  const [colourEast, colourWest, normalEast, normalWest, oceanMap, wave, shore] = await Promise.all(
    [
      texture('colour-east.jpg', true),
      texture('colour-west.jpg', true),
      texture('normal-east.jpg'),
      texture('normal-west.jpg'),
      texture('ocean.jpg', true),
      texture('wave.png'),
      texture('shore.png'),
    ],
  );
  wave.wrapS = wave.wrapT = THREE.RepeatWrapping;
  const uniforms = {
    sun: { value: new THREE.Vector3(1, 1, -1).normalize() },
    time: { value: 0 },
    night: { value: 0 },
    selected: { value: -1 },
    colourEast: { value: colourEast },
    colourWest: { value: colourWest },
    normalEast: { value: normalEast },
    normalWest: { value: normalWest },
    oceanMap: { value: oceanMap },
    wave: { value: wave },
    shore: { value: shore },
  };
  const terrainMaterial = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `attribute float country; varying float vCountry; varying vec3 vWorld; varying vec3 vNormal;
      void main(){vCountry=country;vWorld=(modelMatrix*vec4(position,1.)).xyz;
      vNormal=normalize(mat3(modelMatrix)*normal);gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);}`,
    fragmentShader: `
      uniform sampler2D colourEast,colourWest,normalEast,normalWest;
      uniform vec3 sun; uniform float selected,night;
      varying vec3 vWorld,vNormal; varying float vCountry;
      ${geographic}
      void main(){
        vec3 up=normalize(vWorld);vec2 uv=geoUV(up);
        vec2 tile=vec2(fract(uv.x*2.),uv.y);
        vec3 col=uv.x<.5?texture2D(colourWest,tile).rgb:texture2D(colourEast,tile).rgb;
        vec3 detail=(uv.x<.5?texture2D(normalWest,tile).rgb:texture2D(normalEast,tile).rgb)*2.-1.;
        detail.z=-detail.z;
        vec3 n=normalize(normalize(vNormal)*1.8+normalize(detail)*1.5);
        float light=max(0.,dot(n,sun));
        float day=smoothstep(-.15,.2,dot(up,sun));
        float ambient=.28;
        vec3 dayCol=col*(ambient+light*1.45);
        dayCol*=.72+.28*pow(max(0.,dot(n,up)),3.);
        dayCol=mix(dayCol,vec3(.36,.49,.23),step(abs(vCountry-selected),.25)*.1);
        vec3 nightCol=col*vec3(.12,.19,.3)+vec3(.002,.006,.014);
        vec3 result=mix(nightCol,dayCol,day);
        float dst=distance(cameraPosition,vWorld);
        float haze=(1.-exp(-dst*.0035))*day;
        result=mix(result,vec3(.14,.32,.52),haze*.72);
        gl_FragColor=vec4(result,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });

  const response = await fetch(asset('terrain.bytes'));
  if (!response.ok) throw new Error('Terrain data could not be loaded.');
  const { geometry, names } = parseTerrain(await response.arrayBuffer());
  const terrain = new THREE.Mesh(geometry, terrainMaterial);
  geometry.boundsTree = new MeshBVH(geometry, { targetLeafSize: 12 });
  terrain.raycast = acceleratedRaycast;
  scene.add(terrain);
  onProgress(65);
  const ray = new THREE.Raycaster();
  ray.firstHitOnly = true;
  function groundRadius(up) {
    ray.set(up.clone().multiplyScalar(120), up.clone().negate());
    const hit = ray.intersectObject(terrain, false)[0];
    return hit ? Math.max(RADIUS, hit.point.length()) : RADIUS;
  }

  const ocean = new THREE.Mesh(
    new THREE.SphereGeometry(RADIUS - 0.018, 192, 96),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: sharedVertex,
      fragmentShader: `
      uniform sampler2D oceanMap,wave,shore;uniform float time,night;uniform vec3 sun;varying vec3 vWorld,vNormal;
      ${geographic}
      void main(){
        vec3 up=normalize(vWorld);vec2 uv=geoUV(up);
        vec3 base=texture2D(oceanMap,uv).rgb;
        float shallow=smoothstep(.14,.6,base.g);
        vec3 deep=vec3(.027,.17,.48);
        vec3 shallowCol=vec3(.015,.62,.73);
        vec3 col=mix(deep,shallowCol,shallow);
        col=mix(col,base,.38);
        vec3 a=texture2D(wave,uv*vec2(160.,80.)+time*.0012).xyz*2.-1.;
        vec3 b=texture2D(wave,uv*vec2(113.,56.5)-time*.0008).xyz*2.-1.;
        vec3 east=normalize(vec3(up.z,.00001,-up.x));
        vec3 north=normalize(cross(up,east));
        float detailFade=1.-smoothstep(35.,140.,distance(cameraPosition,vWorld));
        vec3 normal=normalize(up+(east*(a.x+b.x)+north*(a.y+b.y))*.045*detailFade);
        vec3 view=normalize(cameraPosition-vWorld);
        float spec=pow(max(0.,dot(normal,normalize(sun+view))),85.);
        float light=max(0.,dot(up,sun));
        float day=smoothstep(-.15,.2,dot(up,sun));
        col=col*(.65+light*.7)+spec*vec3(1.,.94,.72)*.65;
        float dst=texture2D(shore,uv).r;
        float phase=dst*950.-time*.85+texture2D(wave,uv*vec2(110.,55.)).r*2.;
        float waveCrest=pow(.5+.5*sin(phase),8.);
        float shoreWave=waveCrest*(1.-smoothstep(.005,.023,dst))*smoothstep(0.,.002,dst);
        float foam=(1.-smoothstep(.0005,.0045,dst))*.3+shoreWave*.5;
        col=mix(col,vec3(.59,.87,.86),foam);
        col=mix(vec3(.002,.012,.031),col,day);
        float fresnel=pow(1.-max(0.,dot(up,view)),4.);
        col=mix(col,vec3(.14,.32,.52),fresnel*.3*day);
        gl_FragColor=vec4(col,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    }),
  );
  scene.add(ocean);

  const borderResponse = await fetch(asset('outlines.bin'));
  if (!borderResponse.ok) throw new Error('Country borders could not be loaded.');
  const borderPositions = new Float32Array(await borderResponse.arrayBuffer());
  for (let i = 0; i < borderPositions.length; i += 3) {
    const r = Math.hypot(borderPositions[i], borderPositions[i + 1], borderPositions[i + 2]);
    const k = (RADIUS + (r - 150) * 0.9 + 0.034) / r;
    borderPositions[i] *= k;
    borderPositions[i + 1] *= k;
    borderPositions[i + 2] *= k;
    borderPositions[i + 2] *= -1;
  }
  const borderGeometry = new THREE.BufferGeometry();
  borderGeometry.setAttribute('position', new THREE.BufferAttribute(borderPositions, 3));
  const borders = new THREE.LineSegments(
    borderGeometry,
    new THREE.LineBasicMaterial({ color: 0x152b31, transparent: true, opacity: 0.78 }),
  );
  scene.add(borders);

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1600, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        sun: uniforms.sun,
        up: { value: new THREE.Vector3(0, 1, 0) },
        night: uniforms.night,
      },
      vertexShader:
        'varying vec3 vDirection;void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: `varying vec3 vDirection;uniform vec3 up,sun;uniform float night;
      void main(){vec3 d=normalize(vDirection);float h=clamp((dot(d,up)+.7),0.,1.);
      vec3 day=mix(vec3(.11,.3,.58),vec3(.009,.037,.15),pow(h,.48));
      float glow=pow(max(0.,dot(d,sun)),70.);day+=vec3(1.,.77,.43)*glow*.65;
      vec3 col=mix(day,vec3(.001,.003,.009),night);
      gl_FragColor=vec4(col,1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>}`,
    }),
  );
  scene.add(sky);
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(101.2, 96, 64),
    new THREE.ShaderMaterial({
      uniforms,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: sharedVertex,
      fragmentShader: `uniform vec3 sun;varying vec3 vWorld,vNormal;void main(){
      vec3 v=normalize(cameraPosition-vWorld);float rim=pow(clamp(1.-abs(dot(v,normalize(vNormal))),0.,1.),3.);
      float day=smoothstep(-.4,.5,dot(normalize(vWorld),sun));
      gl_FragColor=vec4(vec3(.12,.38,.7),rim*.12*day);}`,
    }),
  );
  scene.add(atmosphere);

  const ambient = new THREE.HemisphereLight(0xe0f5ff, 0x606044, 2.1);
  const sunlight = new THREE.DirectionalLight(0xfff0cf, 2.7);
  scene.add(ambient, sunlight);
  const clouds = createClouds(scene, groundRadius, uniforms);
  const ships = createShips(scene, groundRadius);
  const stars = createStars(scene);
  onProgress(78);

  const plane = await new FBXLoader().loadAsync(asset('plane.fbx'));
  const yellow = new THREE.MeshPhysicalMaterial({
    color: 0xffc414,
    roughness: 0.36,
    metalness: 0.08,
    clearcoat: 0.45,
    clearcoatRoughness: 0.3,
  });
  const gold = new THREE.MeshStandardMaterial({ color: 0xf2aa06, roughness: 0.58 });
  const red = new THREE.MeshStandardMaterial({ color: 0xf34a27, roughness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x313936, roughness: 0.74 });
  const windowMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x416f7c,
    roughness: 0.12,
    metalness: 0.3,
    clearcoat: 1,
  });
  const propellerMaterial = new THREE.MeshBasicMaterial({
    color: 0xd7e3d8,
    transparent: true,
    opacity: 0.1,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  plane.traverse((o) => {
    if (!o.isMesh) return;
    if (o.geometry.groups.length > 1) mergeGroups(o.geometry);
    const old = o.material;
    if (o.name === 'Prop_circle') o.material = propellerMaterial;
    else if (o.name === 'Window') o.material = windowMaterial;
    else if (/Wheel|Prop$/.test(o.name)) o.material = dark;
    else if (Array.isArray(old))
      o.material = old.map((m) => (m.name === 'C' ? red : m.name === 'Flaps' ? gold : yellow));
    else o.material = /Circle|Support/.test(o.name) ? gold : yellow;
  });
  const propeller = preparePropeller(plane);
  const controls = prepareControlSurfaces(plane);
  plane.scale.setScalar(0.042);
  plane.position.y = -0.8;
  const aircraft = new THREE.Group();
  aircraft.add(plane);
  scene.add(aircraft);
  const planeShadow = makePlaneShadow(scene);
  onProgress(92);
  const countriesResponse = await fetch(asset('countries.json'));
  if (!countriesResponse.ok) throw new Error('Country data could not be loaded.');
  const countries = await countriesResponse.json();
  onProgress(100);
  return {
    uniforms,
    terrain,
    names,
    borders,
    sky,
    ambient,
    sunlight,
    clouds,
    ships,
    stars,
    aircraft,
    plane,
    propeller,
    controls,
    planeShadow,
    groundRadius,
    countries: countries.features,
    atmosphere,
  };
}

export function parseTerrain(buffer) {
  const data = new DataView(buffer);
  const decoder = new TextDecoder('utf-16le');
  let offset = 0;
  const geometries = [],
    names = [];
  const int = () => {
    const n = data.getInt32(offset, true);
    offset += 4;
    return n;
  };
  function floatArray(length) {
    const a = new Float32Array(length);
    for (let i = 0; i < length; i++, offset += 4) a[i] = data.getFloat32(offset, true);
    return a;
  }
  while (offset < buffer.byteLength) {
    const start = offset,
      size = int();
    if (size < 24 || start + size > buffer.byteLength)
      throw new Error('Invalid terrain mesh record.');
    const length = int();
    const name = decoder.decode(new Uint8Array(buffer, offset, length));
    offset += length;
    const count = int(),
      positions = floatArray(count * 3);
    const indexCount = int(),
      indices = new Uint32Array(indexCount);
    for (let i = 0; i < indexCount; i++) indices[i] = int();
    const normals = floatArray(int() * 3);
    const uvCount = int();
    offset += uvCount * 16;
    if (offset !== start + size) throw new Error('Terrain mesh record size mismatch.');
    for (let i = 0; i < positions.length; i += 3) {
      const r = Math.hypot(positions[i], positions[i + 1], positions[i + 2]);
      const k = (RADIUS + (r - 150) * 0.9) / r;
      positions[i] *= k;
      positions[i + 1] *= k;
      positions[i + 2] *= k;
      positions[i + 2] *= -1;
      normals[i + 2] *= -1;
    }
    // Unity serializes clockwise triangles; test and correct winding for WebGL.
    const a = new THREE.Vector3(),
      b = new THREE.Vector3(),
      c = new THREE.Vector3();
    for (let i = 0; i < indices.length; i += 3) {
      a.fromArray(positions, indices[i] * 3);
      b.fromArray(positions, indices[i + 1] * 3);
      c.fromArray(positions, indices[i + 2] * 3);
      if (b.sub(a).cross(c.sub(a)).dot(a) < 0)
        [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute(
      'country',
      new THREE.BufferAttribute(new Float32Array(count).fill(names.length), 1),
    );
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometries.push(geometry);
    names.push(name);
  }
  const geometry = mergeGeometries(geometries);
  geometries.forEach((g) => g.dispose());
  return { geometry, names };
}

function seeded(seed = 42) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createClouds(scene, groundRadius, uniforms) {
  const random = seeded();
  const count = 350,
    puffs = 5;
  const group = new THREE.Group();
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `varying vec3 vWorld,vNormal;
      void main(){
        vec4 world=modelMatrix*instanceMatrix*vec4(position,1.);vWorld=world.xyz;
        vec3 n=normal/vec3(dot(instanceMatrix[0].xyz,instanceMatrix[0].xyz),dot(instanceMatrix[1].xyz,instanceMatrix[1].xyz),dot(instanceMatrix[2].xyz,instanceMatrix[2].xyz));
        vNormal=normalize(mat3(modelMatrix)*mat3(instanceMatrix)*n);
        gl_Position=projectionMatrix*viewMatrix*world;
      }`,
    fragmentShader: `uniform vec3 sun;uniform float night;varying vec3 vWorld,vNormal;
      void main(){
        vec3 n=normalize(vNormal),view=normalize(cameraPosition-vWorld);
        float diffuse=clamp((dot(n,sun)+.65)/1.65,0.,1.);
        float silver=pow(1.-abs(dot(n,view)),3.)*pow(max(0.,dot(view,-sun)),3.);
        vec3 shade=mix(vec3(.44,.55,.66),vec3(1.,.98,.91),diffuse)+silver*.15;
        float haze=1.-exp(-distance(cameraPosition,vWorld)*.004);
        shade=mix(shade,vec3(.27,.46,.68),haze*.5);
        shade=mix(shade,shade*vec3(.085,.12,.19),night);
        gl_FragColor=vec4(shade,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 16, 12),
    material,
    count * puffs,
  );
  const shadowMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    uniforms: { opacity: { value: 0.19 } },
    vertexShader:
      'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}',
    fragmentShader:
      'varying vec2 vUv;uniform float opacity;void main(){float d=length(vUv-.5)*2.;gl_FragColor=vec4(.015,.045,.1,(1.-smoothstep(.4,1.,d))*opacity);}',
  });
  const shadows = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    shadowMaterial,
    count * puffs,
  );
  const dummy = new THREE.Object3D();
  const q = new THREE.Quaternion();
  const upAxis = new THREE.Vector3(0, 1, 0),
    front = new THREE.Vector3(0, 0, 1);
  for (let i = 0; i < count; i++) {
    const lon = random() * 360 - 180,
      lat = (Math.asin(random() * 1.88 - 0.94) * 180) / Math.PI;
    const up = toPoint(lon, lat),
      radius = 109 + random() * 3;
    const height = groundRadius(up);
    q.setFromUnitVectors(upAxis, up);
    const spread = 0.5 + random() * 1.1;
    for (let j = 0; j < puffs; j++) {
      const local = new THREE.Vector3(
        (random() - 0.5) * spread * 2,
        random() * spread * 0.65,
        (random() - 0.5) * spread,
      );
      const s = spread * (0.33 + random() * 0.45);
      dummy.position.copy(up).multiplyScalar(radius).add(local.applyQuaternion(q));
      dummy.quaternion.copy(q);
      dummy.scale.set(s * 1.15, s * 0.82, s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i * puffs + j, dummy.matrix);
      const shadowUp = dummy.position.clone().normalize();
      dummy.position.copy(shadowUp).multiplyScalar(height + 0.055);
      dummy.quaternion.setFromUnitVectors(front, shadowUp);
      dummy.scale.set(s * 2.6, s * 2.6, 1);
      dummy.updateMatrix();
      shadows.setMatrixAt(i * puffs + j, dummy.matrix);
    }
  }
  mesh.instanceMatrix.needsUpdate = shadows.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  shadows.computeBoundingSphere();
  group.add(mesh, shadows);
  scene.add(group);
  group.userData.shadowMaterial = shadowMaterial;
  return group;
}

function createShips(scene, groundRadius) {
  const group = new THREE.Group();
  const coordinates = [
    [12, -31],
    [13, -27],
    [16, -35],
    [20, -37],
    [32, -32],
    [38, -22],
    [5, 36],
    [-8, 49],
    [127, 20],
    [150, -33],
    [-77, -18],
    [55, 12],
    [10, -33],
    [9, -25],
    [15, -36],
  ];
  const materials = [0xc04832, 0x356c61, 0xc6ac67, 0x577781].map(
    (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.8 }),
  );
  const hull = new THREE.MeshStandardMaterial({ color: 0x273c43, roughness: 0.7 });
  const white = new THREE.MeshStandardMaterial({ color: 0xe0ded0 });
  coordinates.forEach(([lon, lat], i) => {
    const up = toPoint(lon, lat);
    if (groundRadius(up) > 100.15) return;
    const ship = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.2, 1.7), hull);
    body.position.y = 0.13;
    ship.add(body);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.32, 0.28), white);
    cabin.position.set(0, 0.34, -0.56);
    ship.add(cabin);
    for (let z = 0; z < 4; z++)
      for (let x = 0; x < 2; x++) {
        const box = new THREE.Mesh(
          new THREE.BoxGeometry(0.21, 0.19, 0.28),
          materials[(i + x + z) % 4],
        );
        box.position.set((x - 0.5) * 0.25, 0.32, z * 0.3 - 0.27);
        ship.add(box);
      }
    ship.position.copy(up).multiplyScalar(100.02);
    ship.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
    ship.rotateY(i * 1.2);
    group.add(ship);
  });
  scene.add(group);
  return group;
}

function createStars(scene) {
  const random = seeded(91),
    vertices = [];
  for (let i = 0; i < 1800; i++) {
    const p = toPoint(random() * 360 - 180, (Math.asin(random() * 2 - 1) * 180) / Math.PI, 1300);
    vertices.push(p.x, p.y, p.z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  const stars = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      color: 0xe2efff,
      size: 1.4,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }),
  );
  scene.add(stars);
  return stars;
}

function makePlaneShadow(scene) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#111c2b';
  ctx.filter = 'blur(2.5px)';
  ctx.beginPath();
  ctx.moveTo(61, 8);
  ctx.lineTo(68, 8);
  ctx.lineTo(71, 40);
  ctx.lineTo(119, 50);
  ctx.lineTo(119, 62);
  ctx.lineTo(70, 60);
  ctx.lineTo(69, 98);
  ctx.lineTo(89, 106);
  ctx.lineTo(89, 112);
  ctx.lineTo(64, 108);
  ctx.lineTo(40, 112);
  ctx.lineTo(40, 106);
  ctx.lineTo(60, 98);
  ctx.lineTo(59, 60);
  ctx.lineTo(9, 62);
  ctx.lineTo(9, 50);
  ctx.lineTo(59, 40);
  ctx.closePath();
  ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(5.2, 5.2),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
    }),
  );
  scene.add(mesh);
  return mesh;
}

export function createPackage(scene, up, forward, groundRadius) {
  const group = new THREE.Group();
  const crate = new THREE.Mesh(
    new THREE.BoxGeometry(0.44, 0.44, 0.44),
    new THREE.MeshStandardMaterial({ color: 0xc89556, roughness: 1 }),
  );
  const strapMaterial = new THREE.MeshStandardMaterial({ color: 0xe1bd7d });
  for (const dim of [
    [0.47, 0.08, 0.47],
    [0.08, 0.47, 0.47],
  ])
    crate.add(new THREE.Mesh(new THREE.BoxGeometry(...dim), strapMaterial));
  group.add(crate);
  const canopy = new THREE.Group();
  const colours = [0xf8ead2, 0xe76542, 0xf8ead2, 0xffcc50, 0xf8ead2, 0xe76542, 0xf8ead2, 0xffcc50];
  for (let i = 0; i < 8; i++) {
    const part = new THREE.Mesh(
      new THREE.SphereGeometry(1.1, 5, 8, (i * Math.PI) / 4, Math.PI / 4, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: colours[i], side: THREE.DoubleSide, roughness: 0.9 }),
    );
    part.scale.y = 0.65;
    canopy.add(part);
    const angle = (i * Math.PI) / 4;
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(Math.cos(angle) * 1.1, 0, Math.sin(angle) * 1.1),
        new THREE.Vector3(0, -1.65, 0),
      ]),
      new THREE.LineBasicMaterial({ color: 0xede5cf }),
    );
    canopy.add(line);
  }
  canopy.position.y = 1.65;
  group.add(canopy);
  const direction = up.clone();
  group.position.copy(up).multiplyScalar(106.1);
  group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
  scene.add(group);
  return {
    group,
    canopy,
    up: direction,
    forward: forward.clone(),
    age: 0,
    radius: 106.1,
    ground: groundRadius(up),
    landed: false,
  };
}
