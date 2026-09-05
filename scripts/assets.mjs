import { mkdir, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../public/assets/', import.meta.url));
const reference = fileURLToPath(new URL('../reference/', import.meta.url));
await mkdir(dir, { recursive: true });
await mkdir(reference, { recursive: true });
const root =
  'https://raw.githubusercontent.com/SebLague/Geographical-Adventures/82fcda20bebb033c749b2339e9ce3a6e58007699/';
const files = {
  'terrain.bytes': 'Assets/Data/Terrain/Terrain Mesh.bytes',
  'plane.fbx': 'Assets/Graphics/Aircraft/Plane.fbx',
  'countries.json': 'Assets/Data/Countries/Source/Countries (low res).txt',
  'outlines.json': 'Assets/Data/Terrain/Outline Paths.json',
  'land-distance.png': 'Assets/Graphics/Water/Land Distance.png',
  'ocean-source.png': 'Assets/Data/Ocean/Ocean.png',
  'colour-east-source.jpg': 'Assets/Data/World Tiles/Colour East.jpg',
  'colour-west-source.jpg': 'Assets/Data/World Tiles/Colour West.jpg',
  'normal-east-source.jpg': 'Assets/Data/World Tiles/Normals East.jpg',
  'normal-west-source.jpg': 'Assets/Data/World Tiles/Normals West.jpg',
  'wave.png': 'Assets/Graphics/Water/water-normal.png',
  'font.ttf': 'Assets/Graphics/UI/Fonts/TTF/Montserrat-Bold.ttf',
  'crate.png': 'Assets/Graphics/Package/Crate/Crate Texture 2.png',
  'LICENSE-original.txt': 'LICENSE',
};
for (const [name, path] of Object.entries(files)) {
  const target = /-source\.|outlines\.json|land-distance\.png/.test(name) ? reference : dir;
  try {
    if ((await stat(target + name)).size > 100) continue;
  } catch {}
  console.log('Downloading', name);
  const response = await fetch(root + path.split('/').map(encodeURIComponent).join('/'));
  if (!response.ok) throw new Error(`${response.status}: ${path}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  await writeFile(target + name, bytes);
  console.log(name, bytes.length);
}
