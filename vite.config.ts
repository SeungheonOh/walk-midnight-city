import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { nativeAssets } from './native-assets.mjs';

export default defineConfig({
  plugins: [react(), tailwindcss(), { name: 'midnight-public-artwork', configureServer(server) {
    server.middlewares.use((request, response, next) => { void nativeAssets(request, response).then(handled => { if (!handled) next(); }).catch(next); });
  } }],
  server: {
    proxy: {
      '/city-assets': {
        target: 'https://www.midnight.city',
        changeOrigin: true,
        proxyTimeout: 30000,
        configure(proxy) {
          proxy.on('proxyReq', request => {
            request.removeHeader('cookie');
            request.removeHeader('authorization');
          });
        },
        rewrite: (path) => path.replace(/^\/city-assets/, '/models/city-neon'),
        bypass(request) {
          if (request.method !== 'GET' || !/^\/city-assets\/[a-z0-9-]+\.glb$/.test(request.url ?? '')) return false;
        },
      },
    },
  },
});
