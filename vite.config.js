import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  plugins: command === 'serve'
    ? [import('@vitejs/plugin-basic-ssl').then((m) => m.default())]
    : [],
  server: {
    https: true,
    port: 8080,
    host: true,
  },
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
  },
  assetsInclude: ['**/*.zpt', '**/*.wasm'],
}));
