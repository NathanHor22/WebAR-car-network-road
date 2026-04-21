import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  plugins: [basicSsl()],
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
});
