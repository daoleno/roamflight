import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [
    {
      name: 'roamflight-license',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'LICENSE.txt',
          source: readFileSync(new URL('./LICENSE', import.meta.url), 'utf8'),
        });
      },
    },
  ],
  build: {
    rollupOptions: {
      input: {
        game: fileURLToPath(new URL('./index.html', import.meta.url)),
        credits: fileURLToPath(new URL('./credits.html', import.meta.url)),
        notFound: fileURLToPath(new URL('./404.html', import.meta.url)),
        authComplete: fileURLToPath(new URL('./auth/complete.html', import.meta.url)),
      },
      output: {
        entryFileNames: 'app/[name]-[hash].js',
        chunkFileNames: 'app/[name]-[hash].js',
        assetFileNames: 'app/[name]-[hash][extname]',
        manualChunks(id) {
          if (id.endsWith('/src/i18n.js')) return 'locale';
          if (id.includes('/node_modules/three/') || id.includes('/node_modules/three-mesh-bvh/'))
            return 'graphics';
        },
      },
    },
  },
});
