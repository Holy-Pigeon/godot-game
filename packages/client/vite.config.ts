import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: here,
  build: {
    outDir: resolve(here, '../../dist/client'),
    emptyOutDir: true,
    // 主包预算 4MB（CLAUDE.md 4.4）。超过就报警，不让它悄悄长大。
    chunkSizeWarningLimit: 4096,
    rollupOptions: {
      output: {
        // Vite 8 的底层是 rolldown，manualChunks 只接受函数形式
        manualChunks: (id: string) => (id.includes('node_modules/phaser') ? 'phaser' : undefined),
      },
    },
  },
  server: { port: 5173, host: true },
})
