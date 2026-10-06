import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { seedWorkspace } from './helpers';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function expectNoViolations(page: Page, label: string) {
  // Let entry animations finish so colours are measured at rest.
  await page.waitForTimeout(600);
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  const summary = violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
  }));
  expect(summary, `${label}: accessibility violations`).toEqual([]);
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    });

    test('public pages', async ({ page }) => {
      for (const path of ['/', '/login', '/signup', '/no-such-page']) {
        await page.goto(path);
        await expectNoViolations(page, `${theme} ${path}`);
      }
    });

    test('dashboard pages', async ({ page }) => {
      await seedWorkspace(page);
      const pages = [
        '/onboarding',
        '/app',
        '/app/requests',
        '/app/cache',
        '/app/keys',
        '/app/settings',
        '/app/playground',
        '/app/evaluate',
      ];
      for (const path of pages) {
        await page.goto(path);
        await page.getByRole('heading', { level: 1 }).first().waitFor();
        await expectNoViolations(page, `${theme} ${path}`);
      }
      // A request detail page, reached from the explorer.
      await page.goto('/app/requests?result=twin');
      await page.locator('tbody a').first().click();
      await page.getByRole('heading', { name: 'The twin it matched' }).waitFor();
      await expectNoViolations(page, `${theme} request detail`);
    });
  });
}
