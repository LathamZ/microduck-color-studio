import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { manifestPath } from './src/models/active';
import { modelRevision, revisionKey, withRevision } from './scripts/model-revision';

/**
 * Write the geometry's revision into the manifest, in dev and in the build.
 *
 * The browser keeps the display GLBs and asks for them again only when this number moves, so it
 * has to be worked out from the files themselves. Doing it here, rather than in a script someone
 * has to remember to run, means it cannot describe anything other than what was just built.
 */
function modelRevisionPlugin(): Plugin {
  // The manifest names its geometry relative to itself, so its own directory is where to look.
  const modelsDir = resolve(__dirname, 'public', dirname(manifestPath));
  const source = resolve(__dirname, 'public', manifestPath);
  let cached: { key: string; revision: string } | null = null;

  /** The manifest as it should be served, with its revision. Read fresh; the hash is memoised. */
  const stamped = () => {
    const text = readFileSync(source, 'utf8');
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const key = revisionKey(modelsDir, parsed);
    if (cached?.key !== key) cached = { key, revision: modelRevision(modelsDir, parsed) };
    return withRevision(text, cached.revision);
  };

  return {
    name: 'model-revision',
    configureServer(server) {
      // Registered here rather than from a returned function, so it runs before the middleware
      // that serves `public/` and the request never reaches the unstamped file.
      server.middlewares.use((req, res, next) => {
        if ((req.url ?? '').split(/[?#]/)[0] !== `/${manifestPath}`) return next();
        try {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(stamped());
        } catch (error) {
          next(error as Error);
        }
      });
    },
    closeBundle() {
      // Runs after Vite has copied `public/` into the output directory, so this rewrites the copy
      // that ships and leaves the committed manifest unstamped.
      try {
        writeFileSync(resolve(__dirname, 'dist', manifestPath), stamped());
      } catch {
        // No manifest in the output: nothing to stamp, and nothing this plugin should invent.
      }
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [modelRevisionPlugin()],
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
