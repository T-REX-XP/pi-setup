import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

/** Dev server + HMR port (avoids ws://localhost:undefined when the client omits the port). */
const port = Number(process.env.PORT || 5174);

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    port,
    strictPort: true,
    hmr: {
      protocol: 'ws',
      host: 'localhost',
      port,
      clientPort: port,
    },
  },
});
