import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    // Reine SPA: der Fastify-Server liefert index.html für alle Seiten aus.
    adapter: adapter({ fallback: 'index.html' }),
  },
};
