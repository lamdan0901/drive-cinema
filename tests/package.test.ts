import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { unzipSync } from 'fflate';
it('packages runnable source without credentials or generated artifacts', () => {
  const root = mkdtempSync(join(tmpdir(), 'drive-package-'));
  try {
    for (const d of ['src', 'node_modules', '.next', '.git', '.codex']) mkdirSync(join(root, d));
    for (const [p, v] of Object.entries({
      'src/app.ts': 'source',
      'package.json': '{}',
      'package-lock.json': '{}',
      '.env.example': 'template',
      '.env.local': 'secret',
      'node_modules/bad.js': 'bad',
      '.next/build.js': 'build',
      '.codex/internal': 'internal',
      'movie.mp4': 'private media',
    }))
      writeFileSync(join(root, p), v);
    const r = spawnSync(process.execPath, [resolve('scripts/package-source.mjs'), root], {
      encoding: 'utf8',
    });
    expect(r.status, r.stderr).toBe(0);
    const files = Object.keys(unzipSync(readFileSync(join(root, 'dist/drive-cinema-source.zip'))));
    expect(files).toContain('drive-cinema/src/app.ts');
    expect(files).toContain('drive-cinema/.env.example');
    expect(
      files.some((f) => /env.local|node_modules|\.next|\.git\/|\.codex|movie.mp4/.test(f)),
    ).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
