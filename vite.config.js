import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

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
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/three/') || id.includes('/node_modules/three-mesh-bvh/'))
            return 'graphics';
        },
      },
    },
  },
});
