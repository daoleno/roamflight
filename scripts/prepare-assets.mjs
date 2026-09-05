import sharp from 'sharp';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const assets = fileURLToPath(new URL('../public/assets/', import.meta.url));
const sourceDir = fileURLToPath(new URL('../reference/', import.meta.url));
await mkdir(sourceDir, { recursive: true });
for (const side of ['east', 'west']) {
  for (const kind of ['colour', 'normal']) {
    const name = `${kind}-${side}`;
    await sharp(sourceDir + `${name}-source.jpg`, { limitInputPixels: false })
      .resize(4096, 4096)
      .jpeg({ quality: kind === 'normal' ? 96 : 93 })
      .toFile(assets + `${name}.jpg`);
    console.log('Prepared', name);
  }
}
await sharp(sourceDir + 'ocean-source.png')
  .resize(4096, 2048)
  .jpeg({ quality: 95 })
  .toFile(assets + 'ocean.jpg');
await sharp(sourceDir + 'land-distance.png')
  .resize(4096, 2048)
  .png()
  .toFile(assets + 'shore.png');
const { paths } = JSON.parse(await readFile(sourceDir + 'outlines.json', 'utf8'));
const positions = [];
for (const { path } of paths) {
  for (let i = 1; i < path.length; i++) {
    for (const p of [path[i - 1], path[i]]) positions.push(p.x, p.y, p.z);
  }
}
await writeFile(assets + 'outlines.bin', Buffer.from(new Float32Array(positions).buffer));
await sharp(assets + 'colour-east.jpg')
  .resize(768)
  .toFile(sourceDir + 'colour-preview.jpg');
console.log('Prepared ocean and borders', positions.length / 6, 'segments');
