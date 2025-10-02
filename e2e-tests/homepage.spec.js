// @ts-check
const { test, expect } = require('@playwright/test');

test('should display "Directorio UNIS" on the homepage', async ({ page }) => {
  await page.goto('/'); // Navega a la URL base (http://localhost:8080)

  // Espera que el título de la página contenga "Directorio UNIS"
  await expect(page).toHaveTitle(/Directorio UNIS/);

  // Espera que el encabezado "Directorio UNIS" sea visible
  await expect(page.getByRole('heading', { name: 'Directorio UNIS' })).toBeVisible();

  // Espera que el campo de búsqueda sea visible
  await expect(page.getByPlaceholder('Buscar por nombre, puesto, departamento o extensión...')).toBeVisible();
});
