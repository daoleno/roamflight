import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

let original = 0,
  compressed = 0;
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(path);
      continue;
    }
    if (
      !/\.(?:js|css|html|json|bytes|bin|fbx|ttf|txt)$/.test(path) ||
      (await stat(path)).size < 1024
    )
      continue;
    const data = await readFile(path);
    const br = brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 6 } });
    const gz = gzipSync(data, { level: 6 });
    if (br.length < data.length * 0.95) await writeFile(path + '.br', br);
    if (gz.length < data.length * 0.95) await writeFile(path + '.gz', gz);
    original += data.length;
    compressed += Math.min(data.length, br.length);
  }
}
await walk(fileURLToPath(new URL('../dist/', import.meta.url)));
console.log(
  `Compressible assets: ${(original / 1e6).toFixed(1)} MB -> ${(compressed / 1e6).toFixed(1)} MB (Brotli)`,
);
