import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false, // Electron tests must be sequential
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker for Electron
  reporter: [
    ['html', { open: 'never' }],
    ['json', { outputFile: 'test-results/e2e-results.json' }]
  ],
  timeout: 60000,
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry'
  },
  projects: [
    {
      name: 'electron',
      testMatch: '**/*.spec.ts'
    }
  ]
})
