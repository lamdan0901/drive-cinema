import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
export default defineConfig({
  resolve: { alias: { '@': resolve('src'), 'server-only': resolve('tests/server-only.ts') } },
  test: { environment: 'node', restoreMocks: true },
});
