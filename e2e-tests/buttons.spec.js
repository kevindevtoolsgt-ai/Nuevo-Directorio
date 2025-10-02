import { test, expect } from '@playwright/test';

test.describe('Frontend Button Tests - Public Page', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('http://localhost:8080'); // Frontend runs on port 8080
    });

    test('should navigate to grid view when "Cuadrícula" button is clicked', async ({ page }) => {
        await page.click('#grid-view-btn');
        await expect(page.locator('#directory-grid')).toHaveClass(/grid-view|row/); // Check for grid-view class or row class
        await expect(page.locator('#grid-view-btn')).toHaveClass(/btn-primary/);
        await expect(page.locator('#list-view-btn')).toHaveClass(/btn-outline-primary/);
    });

    test('should navigate to list view when "Lista" button is clicked', async ({ page }) => {
        await page.click('#list-view-btn');
        await expect(page.locator('#directory-grid')).toHaveClass(/list-view/);
        await expect(page.locator('#list-view-btn')).toHaveClass(/btn-primary/);
        await expect(page.locator('#grid-view-btn')).toHaveClass(/btn-outline-primary/);
    });

    test('should open staff details modal when "Ver Detalles" button is clicked', async ({ page }) => {
        // Assuming there's at least one staff card visible
        const detailsButton = page.locator('.card-footer .btn-primary.btn-sm').first();
        await expect(detailsButton).toBeVisible();
        await detailsButton.click();
        const modal = page.locator('#staffDetailsModal');
        await expect(modal).toBeVisible();
        await expect(modal).toHaveClass(/show/); // Check for Bootstrap's 'show' class
    });

    test('should close staff details modal when close button is clicked', async ({ page }) => {
        // First open the modal
        const detailsButton = page.locator('.card-footer .btn-primary.btn-sm').first();
        await expect(detailsButton).toBeVisible();
        await detailsButton.click();
        const modal = page.locator('#staffDetailsModal');
        await expect(modal).toBeVisible();

        // Then close it
        await page.locator('#staffDetailsModal .btn-close').click();
        await expect(modal).not.toHaveClass(/show/);
        await expect(modal).not.toBeVisible();
    });

    test('should navigate to next carousel item when next button is clicked', async ({ page }) => {
        const carousel = page.locator('#staffCarousel');
        await expect(carousel).toBeVisible();

        // 1. Get a locator for the first item by its position (this is stable)
        const firstItem = carousel.locator('.carousel-item').first();
        // 2. Assert it's the active one to start.
        await expect(firstItem).toHaveClass(/active/);

        // 3. Click the 'next' control button.
        await carousel.locator('.carousel-control-next').click();

        // 4. Assert that the first item (located by its position) is no longer active.
        await expect(firstItem).not.toHaveClass(/active/);
    });

    test('should navigate to previous carousel item when previous button is clicked', async ({ page }) => {
        const carousel = page.locator('#staffCarousel');
        await expect(carousel).toBeVisible();

        // 1. Get locators for the first and second items by POSITION
        const firstItem = carousel.locator('.carousel-item').first();
        const secondItem = carousel.locator('.carousel-item').nth(1);

        // 2. Advance to the next item and verify the change occurred
        await carousel.locator('.carousel-control-next').click();
        await expect(secondItem).toHaveClass(/active/);

        // 3. Click 'previous' to go back
        await carousel.locator('.carousel-control-prev').click();

        // 4. Assert that the first item is active again
        await expect(firstItem).toHaveClass(/active/);
    });

    // Pagination tests (assuming there are enough items to paginate)
    test('should navigate to the next page when next pagination button is clicked', async ({ page }) => {
        // This test assumes there are multiple pages.
        await expect(page.locator('#pagination-controls')).toBeVisible();

        // 1. Start waiting for the response BEFORE clicking
        const responsePromise = page.waitForResponse(response =>
            response.url().includes('/api/public/personal?page=2') && response.status() === 200
        );

        // 2. Click the 'next' arrow button
        await page.getByRole('link', { name: '»' }).click();

        // 3. Wait for the API call to complete
        await responsePromise;

        // 4. Assert that the active page indicator is now '2'
        await expect(page.locator('.pagination .page-item.active a')).toHaveText('2');
    });

    test('should navigate to a specific page when a page number is clicked', async ({ page }) => {
        // This test assumes there are multiple pages and a page '2' exists.
        // You might need to mock API responses or ensure your DB has enough data.
        const pageTwoButton = page.getByRole('link', { name: '2', exact: true });
        if (await pageTwoButton.isVisible()) {
            await pageTwoButton.click();
            await page.waitForLoadState('networkidle');
            await expect(page.locator('.pagination .page-item.active a')).toHaveText('2');
        } else {
            console.warn('Page 2 button not visible, skipping test for specific page navigation.');
            test.skip();
        }
    });
});

test.describe('Frontend Button Tests - Admin Page', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('http://localhost:8080/admin.html'); // Admin page runs on port 8080
    });

    test('should successfully log in with valid credentials', async ({ page }) => {
        await page.fill('#username', 'kfpineda'); // Replace with valid admin username
        await page.fill('#password', 'Admin432'); // Replace with valid admin password
        await page.click('button[type="submit"]');
        await page.waitForLoadState('networkidle'); // Ensure login completes and dashboard is loaded
        await expect(page.locator('#admin-dashboard')).toBeVisible();
        await expect(page.locator('#auth-container')).not.toBeVisible();
    });

    test('should display error message with invalid credentials', async ({ page }) => {
        await page.fill('#username', 'invalid');
        await page.fill('#password', 'credentials');
        await page.click('button[type="submit"]');
        await expect(page.locator('#login-error')).toBeVisible();
        await expect(page.locator('#login-error')).not.toBeEmpty();
        await expect(page.locator('#admin-dashboard')).not.toBeVisible();
    });

    test('should log out when "Cerrar Sesión" button is clicked', async ({ page }) => {
        // First log in
        await page.fill('#username', 'kfpineda'); // Replace with valid admin username
        await page.fill('#password', 'Admin432'); // Replace with valid admin password
        await page.click('button[type="submit"]');
        await expect(page.locator('#admin-dashboard')).toBeVisible();

        await page.click('#logout-btn');
        await expect(page.locator('#auth-container')).toBeVisible();
        await expect(page.locator('#admin-dashboard')).not.toBeVisible();
    });

    test('should navigate to "Gestionar Usuarios" section when its nav link is clicked', async ({ page }) => {
        // Log in first
        await page.fill('#username', 'kfpineda');
        await page.fill('#password', 'Admin432');
        await page.click('button[type="submit"]');
        await expect(page.locator('#admin-dashboard')).toBeVisible();

        await page.click('#nav-manage-users');
        await expect(page.locator('#manage-users-section')).toBeVisible();
        await expect(page.locator('#manage-staff-section')).not.toBeVisible(); // Ensure other sections are hidden
    });

    test('should open staff modal when "Agregar Nuevo Personal" button is clicked', async ({ page }) => {
        // Log in first
        await page.fill('#username', 'kfpineda');
        await page.fill('#password', 'Admin432');
        await page.click('button[type="submit"]');
        await expect(page.locator('#admin-dashboard')).toBeVisible();

        await page.click('#add-staff-btn');
        const staffModal = page.locator('#staff-modal');
        await expect(staffModal).toBeVisible();
        await expect(staffModal).toHaveClass(/show/);
    });

        test('should submit add department form when "Agregar" button is clicked', async ({ page }) => {
        // Log in and navigate to departments section
        await page.fill('#username', 'kfpineda'); // Use valid admin username
        await page.fill('#password', 'Admin432'); // Use valid admin password
        await page.click('button[type="submit"]');
        await expect(page.locator('#admin-dashboard')).toBeVisible();

        await page.click('#nav-manage-departments');
        await expect(page.locator('#manage-departments-section')).toBeVisible();

        const departmentName = `Test Dept ${Date.now()}`;
        await page.fill('#department-name', departmentName);

        // --- INICIO DE LA CORRECCIÓN ---

        // 1. Prepara la espera de la respuesta de la API ANTES de hacer clic.
        // Esto interceptará la llamada POST que crea el departamento.
        const responsePromise = page.waitForResponse(response =>
            response.url().includes('/api/departments') && response.status() === 201 || response.status() === 200
        );

        // 2. Haz clic en el botón para enviar el formulario.
        await page.click('#add-department-form button[type="submit"]');

        // 3. Espera a que la promesa de la respuesta se resuelva.
        // La prueba se detendrá aquí hasta que el backend responda con un código 201 (Creado).
        await responsePromise;

        // 4. Ahora, con la certeza de que el backend funcionó, verifica la UI.
        // Esta aserción ahora comprueba si el frontend actualizó la lista como se esperaba.
        await expect(page.locator('#department-list').getByText(departmentName)).toBeVisible();
        
        // --- FIN DE LA CORRECCIÓN ---
    });


    // Add more tests for other admin buttons (edit, delete, bulk upload, important info, appearance)
    // These will require more complex setup (e.g., creating data to edit/delete)
    // and assertions about API calls or UI changes.
});
