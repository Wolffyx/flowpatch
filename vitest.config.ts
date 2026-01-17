import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules', 'out', 'dist', '**/*.d.ts', '**/*.config.*', 'test/**']
    }
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@shell': resolve(__dirname, 'src/renderer/shell'),
      '@project': resolve(__dirname, 'src/renderer/project')
    }
  }
})
