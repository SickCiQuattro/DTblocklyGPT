import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import viteCompression from 'vite-plugin-compression'
import babel from '@rolldown/plugin-babel'

export default defineConfig(({ mode }) => {
  // Read frontend/.env here as well as in the app, so ONE setting drives both
  // the study-mode UI and the dev server below.
  const env = loadEnv(mode, `${import.meta.dirname}/frontend`, '')
  const studyMode = env.VITE_STUDY_MODE === '1'

  return {
    server: {
      port: 3000,

      // Disables HMR module updates during a study session, so a stray file
      // save cannot swap code under a participant mid-task.
      //
      // What this does NOT do, measured rather than assumed: it does not stop
      // Vite's client from reloading the page. Probed on 2026-09-10 by opening
      // a `vite-hmr` WebSocket against a dev server started both ways — the
      // socket CONNECTS in both. Vite 8 keeps the websocket server up with
      // `hmr: false`, and the reload in
      // node_modules/vite/dist/client/client.mjs
      //
      //     if (payload.event === "vite:ws:disconnect") {
      //       await waitForSuccessfulPing(url.href); location.reload()
      //     }
      //
      // hangs off that socket dropping, not off HMR being enabled.
      //
      // The reliable answer for a measured session is not a dev-server flag at
      // all: build once and serve the build, which contains no Vite client to
      // reload anything. See the README's user-study section.
      hmr: studyMode ? false : undefined,

      proxy: {
        '/camera': {
          target: 'http://localhost:8080',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/camera/, ''),
        },
      },
    },
    build: {
      manifest: true,
      chunkSizeWarningLimit: 2000,
      rollupOptions: {
        output: {
          // The task workspace was one 1.05 MB chunk, and it is the first
          // thing a participant opens. Blockly alone is most of it, and it
          // does not change between builds: split out, it is cached across
          // deploys instead of re-downloaded whenever any app code moves.
          //
          // Split by what changes at a different rate, not by folder: the
          // editor library, the component library, the framework.
          //
          // A function, not an object map — Vite 8 bundles with rolldown,
          // which rejects the object form outright ("manualChunks is not a
          // function").
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return
            if (id.includes('/blockly/')) return 'blockly'
            if (id.includes('/@mui/') || id.includes('/@emotion/')) return 'mui'
            if (
              id.includes('/react/') ||
              id.includes('/react-dom/') ||
              id.includes('/react-router')
            )
              return 'react'
          },
        },
      },
    },
    base: process.env.NODE_ENV === 'production' ? '/static/' : '/',
    root: './frontend',

    resolve: {
      tsconfigPaths: true,
    },

    plugins: [
      react({
        jsxImportSource: '@emotion/react',
      }),
      babel({
        plugins: ['@emotion/babel-plugin'],
      }),
      viteCompression(),
    ],
  }
})
