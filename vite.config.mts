import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import viteCompression from 'vite-plugin-compression'
import babel from '@rolldown/plugin-babel'

export default defineConfig(() => {
  return {
    server: {
      port: 3000,
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
