import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          three: [
            'three',
            'three/addons/controls/OrbitControls.js',
            'three/addons/loaders/GLTFLoader.js',
            'three/addons/environments/RoomEnvironment.js',
          ],
        },
      },
    },
  },
});
