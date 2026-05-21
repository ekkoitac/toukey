import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import path from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: 'src/main/index.ts',
        formats: ['cjs'],
        fileName: () => 'index.js'
      },
      outDir: 'dist/main',
      rollupOptions: {
        external: ['electron', 'node-gyp-build']
      }
    },
    resolve: {
      alias: {
        '@main': path.resolve(__dirname, 'src/main'),
        '@common': path.resolve(__dirname, 'src/common'),
        '@native': path.resolve(__dirname, 'src/native')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: 'src/main/preload.ts',
        formats: ['cjs'],
        fileName: () => 'preload.js'
      },
      outDir: 'dist/preload'
    }
  },
  renderer: {
    root: 'src/renderer',
    build: {
      outDir: 'dist/renderer',
      rollupOptions: {
        input: {
          settings: path.resolve(__dirname, 'src/renderer/settings.html')
        }
      }
    },
    resolve: {
      alias: {
        '@renderer': path.resolve(__dirname, 'src/renderer'),
        '@common': path.resolve(__dirname, 'src/common')
      }
    }
  }
})
