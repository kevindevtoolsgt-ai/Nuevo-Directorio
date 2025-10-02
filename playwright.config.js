// @ts-check
const { defineConfig } = require('@playwright/test');

/**
 * @see https://playwright.dev/docs/test-configuration
 */
module.exports = defineConfig({
  testDir: './e2e-tests', // Aquí se ubicarán tus pruebas End-to-End
  fullyParallel: true, // Ejecuta las pruebas en paralelo
  forbidOnly: !!process.env.CI, // Prohíbe 'test.only' en CI
  retries: process.env.CI ? 2 : 0, // Reintentos en CI
  workers: process.env.CI ? 1 : undefined, // Número de workers en CI
  reporter: 'html', // Genera un reporte HTML de los resultados
  use: {
    trace: 'on-first-retry', // Captura trazas en el primer reintento
    baseURL: 'http://localhost:8080', // URL base de tu aplicación frontend
  },
  projects: [
    {
      name: 'chromium',
      use: { ...require('@playwright/test').devices['Desktop Chrome'] },
    },
  ],
  // Si quisieras que Playwright inicie tu servidor automáticamente, descomentarías esto:
  // webServer: {
  //   command: 'cd backend && npm start',
  //   url: 'http://localhost:8080',
  //   reuseExistingServer: !process.env.CI,
  // },
});