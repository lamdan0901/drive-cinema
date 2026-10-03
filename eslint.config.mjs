import { defineConfig, globalIgnores } from 'eslint/config';
import next from 'eslint-config-next/core-web-vitals';
import ts from 'eslint-config-next/typescript';
export default defineConfig([
  ...next,
  ...ts,
  // These effects synchronize async Drive responses and browser object URLs.
  {
    files: ['src/components/library.tsx', 'src/components/video-player.tsx'],
    rules: { 'react-hooks/set-state-in-effect': 'off' },
  },
  globalIgnores(['.next/**', '.superpowers/**', '.codex/**', 'dist/**', 'next-env.d.ts']),
]);
