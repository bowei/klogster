import { defineConfig } from '@playwright/test';

const port = process.env.KLOGSTER_PORT || '7071';

export default defineConfig({
  testDir: './tests',
  timeout: 15_000,
  retries: 0,
  use: {
    baseURL: `http://localhost:${port}`,
    headless: true,
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
  // Do not spin up a dev server here — run-ui-tests.sh handles it.
  reporter: [['list'], ['html', { open: 'never', outputFolder: '/tmp/klogster-test-report' }]],
});
