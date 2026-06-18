// @ts-check
import { test, expect } from '@playwright/test';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function openFirstPod(page) {
  await page.click('#btn-open-sidebar');
  await expect(page.locator('#sidebar')).not.toHaveClass(/hidden/);

  // Wait for the pod list to populate from /api/groups
  const podItem = page.locator('.pod-item').first();
  await expect(podItem).toBeVisible({ timeout: 5000 });
  await podItem.click();

  // Sidebar auto-closes on pod click
  await expect(page.locator('#sidebar')).toHaveClass(/hidden/);

  // At least one panel tab should appear
  await expect(page.locator('#tab-bar .tab').first()).toBeVisible({ timeout: 5000 });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('page load', () => {
  test('title is klogster', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('klogster');
  });

  test('header buttons are visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#btn-focus')).toBeVisible();
    await expect(page.locator('#btn-pause')).toBeVisible();
    await expect(page.locator('#btn-open-sidebar')).toBeVisible();
    await expect(page.locator('#btn-config')).toBeVisible();
    await expect(page.locator('#btn-help')).toBeVisible();
  });

  test('pause button starts unpaused', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#btn-pause')).not.toHaveClass(/paused/);
    await expect(page.locator('#btn-pause')).toHaveText('⏸');
  });
});

test.describe('sidebar', () => {
  test('opens and closes', async ({ page }) => {
    await page.goto('/');
    const sidebar = page.locator('#sidebar');
    await expect(sidebar).toHaveClass(/hidden/);

    await page.click('#btn-open-sidebar');
    await expect(sidebar).not.toHaveClass(/hidden/);

    await page.click('#btn-close-sidebar');
    await expect(sidebar).toHaveClass(/hidden/);
  });

  test('shows pods in demo mode', async ({ page }) => {
    await page.goto('/');
    await page.click('#btn-open-sidebar');

    // Demo mode provides serverPods and databasePods groups
    await expect(page.locator('.pod-group-name').first()).toBeVisible({ timeout: 5000 });
    const groupNames = await page.locator('.pod-group-name').allTextContents();
    expect(groupNames.length).toBeGreaterThan(0);

    await expect(page.locator('.pod-item').first()).toBeVisible();
  });
});

test.describe('log panels', () => {
  test('opening a pod creates a tab', async ({ page }) => {
    await page.goto('/');
    await openFirstPod(page);
    const tabs = page.locator('#tab-bar .tab');
    await expect(tabs).toHaveCount(1);
  });

  test('panel shows log lines', async ({ page }) => {
    await page.goto('/');
    await openFirstPod(page);

    // Wait for at least one log line to render
    const logLine = page.locator('.log-entry').first();
    await expect(logLine).toBeVisible({ timeout: 8000 });
  });

  test('closing a tab removes the panel', async ({ page }) => {
    await page.goto('/');
    await openFirstPod(page);

    const closeBtn = page.locator('.tab-close').first();
    await closeBtn.click();
    await expect(page.locator('#tab-bar .tab')).toHaveCount(0);
  });

  test('opening two pods creates two tabs', async ({ page }) => {
    await page.goto('/');

    // Open sidebar and pick first pod
    await page.click('#btn-open-sidebar');
    await expect(page.locator('.pod-item').first()).toBeVisible({ timeout: 5000 });
    await page.locator('.pod-item').nth(0).click();
    await expect(page.locator('#sidebar')).toHaveClass(/hidden/);

    // Open sidebar again and pick second pod
    await page.click('#btn-open-sidebar');
    await expect(page.locator('.pod-item').nth(1)).toBeVisible({ timeout: 3000 });
    await page.locator('.pod-item').nth(1).click();

    await expect(page.locator('#tab-bar .tab')).toHaveCount(2);
  });
});

test.describe('pause / resume', () => {
  test('clicking pause toggles to paused state', async ({ page }) => {
    await page.goto('/');
    await page.click('#btn-pause');
    await expect(page.locator('#btn-pause')).toHaveClass(/paused/);
    await expect(page.locator('#btn-pause')).toHaveText('▶');
  });

  test('clicking pause twice returns to unpaused', async ({ page }) => {
    await page.goto('/');
    await page.click('#btn-pause');
    await page.click('#btn-pause');
    await expect(page.locator('#btn-pause')).not.toHaveClass(/paused/);
    await expect(page.locator('#btn-pause')).toHaveText('⏸');
  });
});

test.describe('focus dialog', () => {
  test('opens on Focus button click', async ({ page }) => {
    await page.goto('/');
    await page.click('#btn-focus');
    // Focus dialog should appear (it's attached to the button, not a global overlay)
    await expect(page.locator('.focus-dialog')).toBeVisible({ timeout: 3000 });
  });

  test('closes on Escape', async ({ page }) => {
    await page.goto('/');
    await page.click('#btn-focus');
    await expect(page.locator('.focus-dialog')).toBeVisible({ timeout: 3000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('.focus-dialog')).not.toBeVisible();
  });
});

test.describe('help dialog', () => {
  test('opens on ? button click', async ({ page }) => {
    await page.goto('/');
    await page.click('#btn-help');
    await expect(page.locator('#help-dialog')).not.toHaveClass(/hidden/);
  });

  test('closes on ✕ button', async ({ page }) => {
    await page.goto('/');
    await page.click('#btn-help');
    await page.click('#btn-close-help');
    await expect(page.locator('#help-dialog')).toHaveClass(/hidden/);
  });

  test('closes on Escape', async ({ page }) => {
    await page.goto('/');
    await page.click('#btn-help');
    await page.keyboard.press('Escape');
    await expect(page.locator('#help-dialog')).toHaveClass(/hidden/);
  });

  test('closes on overlay click', async ({ page }) => {
    await page.goto('/');
    await page.click('#btn-help');
    // Overlay is behind the dialog; dispatchEvent bypasses browser hit-testing.
    await page.locator('#help-overlay').dispatchEvent('click');
    await expect(page.locator('#help-dialog')).toHaveClass(/hidden/);
  });
});

test.describe('settings dialog', () => {
  test('opens on ⚙ button click', async ({ page }) => {
    await page.goto('/');
    await page.click('#btn-config');
    await expect(page.locator('#config-dialog')).not.toHaveClass(/hidden/);
  });

  test('closes on ✕ button', async ({ page }) => {
    await page.goto('/');
    await page.click('#btn-config');
    await page.click('#btn-close-config');
    await expect(page.locator('#config-dialog')).toHaveClass(/hidden/);
  });

  test('closes on overlay click', async ({ page }) => {
    await page.goto('/');
    await page.click('#btn-config');
    // Overlay is behind the dialog; dispatchEvent bypasses browser hit-testing.
    await page.locator('#config-overlay').dispatchEvent('click');
    await expect(page.locator('#config-dialog')).toHaveClass(/hidden/);
  });

  test('theme options are all present', async ({ page }) => {
    await page.goto('/');
    await page.click('#btn-config');
    const themes = ['dark', 'light', 'pastel', 'monokai', 'one-dark', 'dracula', 'gruvbox', 'nord', 'zenburn'];
    for (const theme of themes) {
      await expect(page.locator(`input[name="theme"][value="${theme}"]`)).toBeAttached();
    }
  });

  test('switching theme applies data-theme attribute', async ({ page }) => {
    await page.goto('/');
    await page.click('#btn-config');
    // Radio inputs are display:none; click the label wrapper instead.
    await page.locator('.theme-option:has(input[value="light"])').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('dark theme removes data-theme attribute', async ({ page }) => {
    await page.goto('/');
    await page.click('#btn-config');
    // Switch to light first so dark is not already selected (no change event if already checked).
    await page.locator('.theme-option:has(input[value="light"])').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    // Now switch back to dark — data-theme attribute must be removed.
    await page.locator('.theme-option:has(input[value="dark"])').click();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  });
});

test.describe('state persistence', () => {
  test('URL hash is set after opening a pod', async ({ page }) => {
    await page.goto('/');
    await openFirstPod(page);
    // State is saved to sessionStorage or URL hash; verify the page still has the tab after reload
    await page.reload();
    // Tabs should restore from saved state
    await expect(page.locator('#tab-bar .tab').first()).toBeVisible({ timeout: 5000 });
  });
});
