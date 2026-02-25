import { expect, test } from '@playwright/test';

test('dashboard redirects unauthenticated users to login', async ({ page }) => {
	await page.goto('/dashboard');
	await expect(page).toHaveURL(/\/auth\/login/);
});
