import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  {
    extends: './vitest.config.ts',
    test: {
      name: 'shared',
      include: ['src/shared/**/*.test.ts'],
      environment: 'node'
    }
  },
  {
    extends: './vitest.config.ts',
    test: {
      name: 'main',
      include: ['src/main/**/*.test.ts'],
      environment: 'node',
      setupFiles: ['./test/setup/main.ts']
    }
  },
  {
    extends: './vitest.config.ts',
    test: {
      name: 'renderer',
      include: ['src/renderer/**/*.test.{ts,tsx}'],
      environment: 'happy-dom',
      setupFiles: ['./test/setup/renderer.ts']
    }
  }
])
