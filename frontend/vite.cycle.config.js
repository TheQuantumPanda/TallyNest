// Local disposable fixture only. Not referenced by `npm run dev` or `npm run build`.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const fixtureRoot = fileURLToPath(new URL('../backend/integration/cycle-ui/', import.meta.url));
const packageRoot = fileURLToPath(new URL('.', import.meta.url));
const frontendPackages = [
  'react',
  'react-dom',
  'react-router-dom',
  'motion',
  'zod',
  'axios',
  'lucide-react',
  '@fontsource-variable/manrope',
];
export default defineConfig({
  root: fixtureRoot,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: frontendPackages.map((name) => ({
      find: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=/|$)`),
      replacement: `${packageRoot}node_modules/${name}`,
    })),
  },
  server: {
    host: 'localhost',
    port: 5174,
    strictPort: true,
    fs: {
      allow: [
        fileURLToPath(new URL('.', import.meta.url)),
        fileURLToPath(new URL('../shared', import.meta.url)),
        fixtureRoot,
      ],
    },
  },
});
