import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const source = fileURLToPath(new URL('../dist/', import.meta.url));
const target = fileURLToPath(new URL('../pages-dist/', import.meta.url));
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
await stat(join(source, 'index.html'));
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
// Pages negotiates compression at the edge; don't upload redundant local-server variants.
await cp(source, target, { recursive: true, filter: (path) => !/\.(?:br|gz)$/.test(path) });
await writeFile(
  join(target, 'health.json'),
  JSON.stringify({ status: 'ok', service: 'roamflight', version }),
);

let files = 0,
  bytes = 0;
async function validate(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await validate(path);
      continue;
    }
    if (!entry.isFile() || entry.name.startsWith('.'))
      throw new Error(`Unexpected deployment entry: ${path}`);
    const { size } = await stat(path);
    if (size > 25 * 1024 * 1024) throw new Error(`Asset exceeds Pages 25 MiB limit: ${entry.name}`);
    files++;
    bytes += size;
  }
}
await validate(target);
if (files > 20000)
  throw new Error('Pages asset count exceeds the conservative 20,000-file budget.');
console.log(
  `Pages artifact: ${files} files, ${(bytes / 1e6).toFixed(1)} MB, no source files or local compression variants.`,
);
