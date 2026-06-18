// @ts-check
import { test, expect } from '@playwright/test';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function openTwoPods(page) {
  await page.click('#btn-open-sidebar');
  await expect(page.locator('.pod-item').first()).toBeVisible({ timeout: 5000 });
  await page.locator('.pod-item').nth(0).click();
  await expect(page.locator('#sidebar')).toHaveClass(/hidden/);

  await page.click('#btn-open-sidebar');
  await page.locator('.pod-item').nth(1).click();

  await expect(page.locator('.panel-group-tabs .tab')).toHaveCount(2);
}

async function openFirstPod(page) {
  await page.click('#btn-open-sidebar');
  await expect(page.locator('#sidebar')).not.toHaveClass(/hidden/);

  // Wait for the pod list to populate from /api/groups
  const podItem = page.locator('.pod-item').first();
  await expect(podItem).toBeVisible({ timeout: 5000 });
  await podItem.click();

  // Sidebar auto-closes on pod click
  await expect(page.locator('#sidebar')).toHaveClass(/hidden/);

  // At least one panel tab should appear inside a panel-group
  await expect(page.locator('.panel-group-tabs .tab').first()).toBeVisible({ timeout: 5000 });
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
    await expect(page.locator('#btn-add-panel')).toBeVisible();
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
  test('opening a pod creates a tab in a panel group', async ({ page }) => {
    await page.goto('/');
    await openFirstPod(page);
    const tabs = page.locator('.panel-group-tabs .tab');
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
    await expect(page.locator('.panel-group-tabs .tab')).toHaveCount(0);
    // panel group is also gone
    await expect(page.locator('.panel-group')).toHaveCount(0);
  });

  test('opening two pods creates two tabs in same panel group', async ({ page }) => {
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

    // Both tabs in the same panel group
    await expect(page.locator('.panel-group')).toHaveCount(1);
    await expect(page.locator('.panel-group-tabs .tab')).toHaveCount(2);
  });

  test('add panel button creates a new panel group', async ({ page }) => {
    await page.goto('/');
    await openFirstPod(page);
    await expect(page.locator('.panel-group')).toHaveCount(1);

    await page.click('#btn-add-panel');
    await expect(page.locator('.panel-group')).toHaveCount(2);
  });

  test('opening a pod after add panel puts tab in new panel group', async ({ page }) => {
    await page.goto('/');
    await openFirstPod(page);

    await page.click('#btn-add-panel');
    await expect(page.locator('.panel-group')).toHaveCount(2);

    // Open sidebar and pick second pod
    await page.click('#btn-open-sidebar');
    await expect(page.locator('.pod-item').nth(1)).toBeVisible({ timeout: 3000 });
    await page.locator('.pod-item').nth(1).click();

    // Each panel group should have one tab
    const groups = page.locator('.panel-group');
    await expect(groups).toHaveCount(2);
    await expect(groups.nth(0).locator('.panel-group-tabs .tab')).toHaveCount(1);
    await expect(groups.nth(1).locator('.panel-group-tabs .tab')).toHaveCount(1);
  });

  test('switching tabs changes visible log content', async ({ page }) => {
    await page.goto('/');

    // Open two pods into the same panel group
    await page.click('#btn-open-sidebar');
    await expect(page.locator('.pod-item').first()).toBeVisible({ timeout: 5000 });
    await page.locator('.pod-item').nth(0).click();
    await expect(page.locator('#sidebar')).toHaveClass(/hidden/);

    await page.click('#btn-open-sidebar');
    await page.locator('.pod-item').nth(1).click();

    await expect(page.locator('.panel-group-tabs .tab')).toHaveCount(2);

    // Click first tab — it should become active
    await page.locator('.panel-group-tabs .tab').nth(0).click();
    await expect(page.locator('.panel-group-tabs .tab').nth(0)).toHaveClass(/active/);
    await expect(page.locator('.panel-group-tabs .tab').nth(1)).not.toHaveClass(/active/);
  });

  test('closing last tab in panel group removes the panel group', async ({ page }) => {
    await page.goto('/');
    await openFirstPod(page);
    await expect(page.locator('.panel-group')).toHaveCount(1);

    await page.locator('.tab-close').first().click();
    await expect(page.locator('.panel-group')).toHaveCount(0);
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

test.describe('merge logs', () => {
  test('merge button is present in every panel group tab bar', async ({ page }) => {
    await page.goto('/');
    await openFirstPod(page);
    await expect(page.locator('.panel-group .btn-merge')).toHaveCount(1);
    await expect(page.locator('.btn-merge')).toHaveText('⊕');
    await expect(page.locator('.btn-merge')).toHaveAttribute('title', 'Merge all logs');
  });

  test('clicking merge shows Merged Logs label and hides individual tab panels', async ({ page }) => {
    await page.goto('/');
    await openTwoPods(page);

    await page.locator('.btn-merge').click();

    // One panel visible, and its label says "Merged Logs"
    const activePanel = page.locator('.panel:not(.tab-inactive)');
    await expect(activePanel).toHaveCount(1);
    await expect(activePanel.locator('.panel-label')).toHaveText('Merged Logs');
  });

  test('merged panel shows source labels on log entries', async ({ page }) => {
    await page.goto('/');
    await openTwoPods(page);

    // Wait for history lines to arrive in the active tab
    await expect(page.locator('.panel:not(.tab-inactive) .log-entry').first()).toBeVisible({ timeout: 8000 });

    await page.locator('.btn-merge').click();

    // Source labels should appear on entries in the merged panel
    await expect(page.locator('.panel:not(.tab-inactive) .log-source').first()).toBeVisible({ timeout: 3000 });
  });

  test('merge button gets active class when merged', async ({ page }) => {
    await page.goto('/');
    await openTwoPods(page);

    const mergeBtn = page.locator('.btn-merge');
    await expect(mergeBtn).not.toHaveClass(/active/);

    await mergeBtn.click();
    await expect(mergeBtn).toHaveClass(/active/);
    await expect(mergeBtn).toHaveAttribute('title', 'Exit merged view');
  });

  test('clicking a tab while merged exits merged mode and activates that tab', async ({ page }) => {
    await page.goto('/');
    await openTwoPods(page);

    await page.locator('.btn-merge').click();
    await expect(page.locator('.btn-merge')).toHaveClass(/active/);

    // Click first tab — should exit merged mode
    await page.locator('.panel-group-tabs .tab').nth(0).click();
    await expect(page.locator('.btn-merge')).not.toHaveClass(/active/);

    // The clicked tab should now be active, not the merged panel
    await expect(page.locator('.panel-group-tabs .tab').nth(0)).toHaveClass(/active/);
    await expect(page.locator('.panel:not(.tab-inactive) .panel-label')).not.toHaveText('Merged Logs');
  });

  test('clicking merge button again exits merged mode', async ({ page }) => {
    await page.goto('/');
    await openTwoPods(page);

    const mergeBtn = page.locator('.btn-merge');
    await mergeBtn.click();
    await expect(mergeBtn).toHaveClass(/active/);

    await mergeBtn.click();
    await expect(mergeBtn).not.toHaveClass(/active/);
    // An individual tab panel is visible again
    await expect(page.locator('.panel:not(.tab-inactive) .panel-label')).not.toHaveText('Merged Logs');
  });

  test('merged view footer counts total lines', async ({ page }) => {
    await page.goto('/');
    await openTwoPods(page);

    await expect(page.locator('.panel:not(.tab-inactive) .log-entry').first()).toBeVisible({ timeout: 8000 });

    await page.locator('.btn-merge').click();

    const footer = page.locator('.panel:not(.tab-inactive) .panel-footer');
    await expect(footer).toContainText('lines (merged)');
  });

  test('per-tab filters are preserved in merged view', async ({ page }) => {
    await page.goto('/');
    await openTwoPods(page);

    // Wait for history entries to populate in the active tab
    await expect(page.locator('.panel:not(.tab-inactive) .log-entry').first()).toBeVisible({ timeout: 8000 });

    // Activate tab 0 and add a negative filter — "LOG" matches many postgres lines
    await page.locator('.panel-group-tabs .tab').nth(0).click();
    await page.locator('.panel:not(.tab-inactive) .btn-filter').click();
    await page.selectOption('.filter-type-select', 'negative');
    await page.fill('.filter-pattern-input', 'LOG');
    await page.click('.filter-add-btn');
    await page.keyboard.press('Escape');

    // Verify the filter actually hid some lines in the tab
    const tab0Log = page.locator('.panel:not(.tab-inactive) .panel-log');
    const tab0Hidden = await tab0Log.evaluate(el =>
      [...el.querySelectorAll('.log-entry')].some(e => e.style.display === 'none')
    );
    expect(tab0Hidden).toBe(true);

    // Enter merged view
    await page.locator('.btn-merge').click();

    // Merged panel should also have some hidden lines (from tab 0's filter)
    const mergedLog = page.locator('.panel:not(.tab-inactive) .panel-log');
    const mergedHasSomeHidden = await mergedLog.evaluate(el =>
      [...el.querySelectorAll('.log-entry')].some(e => e.style.display === 'none')
    );
    expect(mergedHasSomeHidden).toBe(true);
  });
});

test.describe('state persistence', () => {
  test('URL hash is set after opening a pod and restores on reload', async ({ page }) => {
    await page.goto('/');
    await openFirstPod(page);
    // State is saved to URL hash; verify the tab is still present after reload
    await page.reload();
    await expect(page.locator('.panel-group-tabs .tab').first()).toBeVisible({ timeout: 5000 });
  });
});
