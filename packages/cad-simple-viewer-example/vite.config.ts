import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { defineConfig, normalizePath, type Plugin } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'

const cadWorkerFiles = {
  '/workers/dxf-parser-worker.js': resolve(
    __dirname,
    'node_modules/@mlightcad/data-model/dist/dxf-parser-worker.js'
  ),
  '/workers/libredwg-parser-worker.js': resolve(
    __dirname,
    'node_modules/@mlightcad/cad-simple-viewer/dist/libredwg-parser-worker.js'
  ),
  '/workers/mtext-renderer-worker.js': resolve(
    __dirname,
    'node_modules/@mlightcad/cad-simple-viewer/dist/mtext-renderer-worker.js'
  )
}

function cadWorkerDevServer(): Plugin {
  return {
    name: 'cad-worker-dev-server',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!request.url) {
          next()
          return
        }

        const pathname = new URL(request.url, 'http://localhost').pathname
        const filePath = cadWorkerFiles[pathname as keyof typeof cadWorkerFiles]

        if (!filePath) {
          next()
          return
        }

        if (!existsSync(filePath)) {
          response.statusCode = 404
          response.end(`CAD worker not found: ${pathname}`)
          return
        }

        response.setHeader(
          'Content-Type',
          'application/javascript; charset=utf-8'
        )
        response.setHeader('Cache-Control', 'no-store')

        if (request.method === 'HEAD') {
          response.statusCode = 200
          response.end()
          return
        }

        if (request.method !== 'GET') {
          response.statusCode = 405
          response.end('Method Not Allowed')
          return
        }

        response.statusCode = 200
        response.end(readFileSync(filePath))
      })
    }
  }
}

export default defineConfig(() => {
  return {
    base: './',
    build: {
      modulePreload: false,
      minify: true,
      rollupOptions: {
        // Main entry point for the app
        input: {
          main: resolve(__dirname, 'index.html')
        }
      }
    },
    plugins: [
      cadWorkerDevServer(),
      viteStaticCopy({
        // Keep production worker URLs aligned with the dev middleware above.
        targets: [
          {
            src: normalizePath(
              resolve(
                __dirname,
                'node_modules/@mlightcad/data-model/dist/dxf-parser-worker.js'
              )
            ),
            dest: 'workers'
          },
          {
            src: normalizePath(
              resolve(
                __dirname,
                'node_modules/@mlightcad/cad-simple-viewer/dist/*-worker.js'
              )
            ),
            dest: 'workers'
          }
        ]
      })
    ]
  }
})
