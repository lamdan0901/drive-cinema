import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { zipSync } from 'fflate';
const root = resolve(process.argv[2] ?? '.');
const directories = new Set(['src', 'tests', 'scripts', 'docs']);
const rootFiles = new Set([
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'next.config.ts',
  'next-env.d.ts',
  'eslint.config.mjs',
  'vitest.config.ts',
  '.gitignore',
  '.env.example',
  '.dockerignore',
  'Dockerfile',
  'README.md',
  '.prettierrc.json',
  'playwright.config.ts',
]);
const sourceExtensions = /\.(ts|tsx|mjs|js|json|css|md)$/i;
const entries = {};
async function walk(path = '', top = true) {
  for (const item of await readdir(join(root, path), { withFileTypes: true })) {
    const name = path ? path + '/' + item.name : item.name;
    if (item.isSymbolicLink()) continue;
    if (item.isDirectory()) {
      if (
        (top && directories.has(item.name)) ||
        (!top && !item.name.startsWith('.') && item.name !== 'node_modules' && item.name !== 'dist')
      )
        await walk(name, false);
    } else if (
      item.isFile() &&
      ((top && rootFiles.has(item.name)) ||
        (!top && sourceExtensions.test(item.name) && !item.name.startsWith('.env')))
    ) {
      entries['drive-cinema/' + name] = [
        new Uint8Array(await readFile(join(root, name))),
        { mtime: new Date('2026-01-01T00:00:00Z') },
      ];
    }
  }
}
await walk();
await mkdir(join(root, 'dist'), { recursive: true });
const output = join(root, 'dist/drive-cinema-source.zip');
await writeFile(output, zipSync(entries, { level: 6 }));
console.log(`Source archive: ${output} (${Object.keys(entries).length} files)`);
