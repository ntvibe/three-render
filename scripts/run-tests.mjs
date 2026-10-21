import { createServer } from 'vite';
import { createServer as createHttpServer } from 'node:http';

// SSR-only regressions need module transforms, not a listening HTTP/HMR port.
const hmrServer = createHttpServer();
const server = await createServer({
  server: { middlewareMode: true, hmr: { server: hmrServer } },
  // Use the same ESM dependency entry points as the browser. The tracer's CJS
  // bundle otherwise loads a circular three-mesh-bvh compatibility entry.
  ssr: { noExternal: ['three-gpu-pathtracer', 'three-mesh-bvh'] },
  logLevel: 'error',
});
try {
  const { runRegressions } = await server.ssrLoadModule('/tests/editor.regression.ts');
  await runRegressions();
} finally {
  await server.close();
}
