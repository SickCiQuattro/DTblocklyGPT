import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import viteTsconfigPaths from 'vite-tsconfig-paths'
import viteCompression from 'vite-plugin-compression'

export default defineConfig(() => {
  return {
    server: {
      port: 3000,
    },
    build: {
      manifest: true,
      chunkSizeWarningLimit: 2000,
    },
    base: process.env.NODE_ENV === 'production' ? '/static/' : '/',
    root: './frontend',
    plugins: [
      react({
        jsxImportSource: '@emotion/react',
        babel: {
          plugins: ['@emotion/babel-plugin'],
        },
      }),
      viteTsconfigPaths(),
      viteCompression(),
    ],
  }
})
