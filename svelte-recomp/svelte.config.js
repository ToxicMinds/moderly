import adapterAuto from '@sveltejs/adapter-auto';
import adapterStatic from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// The app is already a fully client-side SPA (root +layout.ts sets
// prerender = true, ssr = false). For the web (Vercel) we keep adapter-auto
// with its default settings so the live deploy is completely unaffected.
// For the native Capacitor Android build we emit a static bundle (with
// relative asset paths, so it works when served from the APK's local origin)
// that ships inside the APK. Selected with BUILD_TARGET=capacitor.
const isCapacitor = process.env.BUILD_TARGET === 'capacitor';

const config = {
  preprocess: vitePreprocess(),
  kit: isCapacitor
    ? {
        adapter: adapterStatic({ fallback: 'index.html', strict: false }),
        paths: { relative: true }
      }
    : {
        adapter: adapterAuto(),
        // The commit, when shipped through scripts/ship.sh, so the live check can
        // tell the site serves exactly what was verified (ENGINEERING.md).
        version: { name: process.env.APP_VERSION || Date.now().toString() }
      }
};

export default config;
