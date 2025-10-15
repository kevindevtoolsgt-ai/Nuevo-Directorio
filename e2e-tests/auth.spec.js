import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {

  test('should allow an admin to log in', async ({ page }) => {
    await page.goto('/admin.html');

    await page.fill('#username', 'kfpineda');
    await page.fill('#password', 'Admin432');
    await page.click('#login-form button[type="submit"]');

    // Assert that the admin dashboard is visible after successful login
    await expect(page.locator('#admin-dashboard')).toBeVisible();
    // Assert that the login form is hidden
    await expect(page.locator('#auth-container')).toBeHidden();
  });

  // TODO: Add test for invalid login
  // TODO: Add test for admin creating a new user (after successful login)

});
