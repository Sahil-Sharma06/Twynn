import { expect, test } from '@playwright/test';
import { ask, FRANCE, FRANCE_TWIN, MOCK_PROVIDER, seedWorkspace, uniqueEmail } from './helpers';

test('a new user goes from sign-up to watching an exact hit and a twin hit', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Get started' }).first().click();

  await page.getByLabel('Email').fill(uniqueEmail());
  await page.getByLabel('Password').fill('correct horse battery');
  await page.getByRole('button', { name: 'Create account' }).click();

  // Onboarding: provider, key (shown once), snippet, then the live wait.
  await expect(page.getByRole('heading', { name: 'Connect your provider' })).toBeVisible();
  await page.getByLabel('Base URL').fill(MOCK_PROVIDER);
  await page.getByLabel('Provider API key').fill('sk-e2e-mock');
  await page.getByRole('button', { name: 'Connect provider' }).click();

  await page.getByRole('button', { name: 'Create key' }).click();
  const key = (await page.locator('code', { hasText: /^twynn_sk_/ }).textContent()) ?? '';
  expect(key).toMatch(/^twynn_sk_/);
  await page.getByRole('button', { name: 'I have saved my key' }).click();
  await expect(page.locator('code', { hasText: key })).toBeVisible(); // the snippet uses it
  await page.getByRole('button', { name: 'I have sent it' }).click();
  await expect(page.getByText('Waiting for your first request…')).toBeVisible();

  await ask(request, key, FRANCE);
  await expect(page.getByText('Your gateway is live')).toBeVisible();
  const repeat = await ask(request, key, FRANCE);
  expect(repeat.headers()['x-twynn-cache-layer']).toBe('exact');
  await expect(page.getByText(/That repeat was answered from the cache/)).toBeVisible();
  const twin = await ask(request, key, FRANCE_TWIN);
  expect(twin.headers()['x-twynn-cache-layer']).toBe('twin');

  // Dashboard: the live feed shows the twin hit; the explorer explains it.
  await page.getByRole('link', { name: 'Go to your dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.getByText('Twin hit').first()).toBeVisible();

  await page
    .getByRole('navigation', { name: 'Dashboard' })
    .getByRole('link', { name: 'Requests' })
    .click();
  await page.getByRole('button', { name: 'Twin hits' }).click();
  await expect(page).toHaveURL(/result=twin/);
  await page.getByRole('link', { name: FRANCE_TWIN }).click();
  await expect(page.getByRole('heading', { name: 'The twin it matched' })).toBeVisible();
  await expect(page.getByText(FRANCE, { exact: true })).toBeVisible();
});

test('settings preview a threshold from real traffic before saving', async ({ page }) => {
  await seedWorkspace(page);
  await page.goto('/app/settings');
  const slider = page.getByRole('slider', { name: 'Twin threshold' });
  await expect(
    page.getByText(/twin searches .* would have been answered from the cache at 0\.950/),
  ).toBeVisible();
  await slider.focus();
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowLeft'); // 0.950 → 0.900
  await expect(page.getByText('1 unsaved change')).toBeVisible();
  await expect(page.getByText(/at 0\.900/)).toBeVisible();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText(/Saved\. New requests use these settings/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole('slider', { name: 'Twin threshold' })).toHaveValue('0.9');
});

test('the playground runs real requests side by side', async ({ page }) => {
  await seedWorkspace(page);
  await page.goto('/app/playground');
  const a = page.getByRole('region', { name: 'A' });
  const b = page.getByRole('region', { name: 'B' });
  await a.getByLabel('Prompt').fill('A brand new playground question');
  await page.getByRole('button', { name: 'Copy A to B' }).click();
  await page.getByRole('button', { name: 'Send both' }).click();
  await expect(a.getByText('Miss')).toBeVisible();
  await expect(b.getByText('Exact hit')).toBeVisible();
  await expect(b.getByText(/Mock answer \d+ to: A brand new playground question/)).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'faster' })).toBeVisible();

  await page.goto('/app/requests?source=playground');
  await expect(page.getByRole('link', { name: 'A brand new playground question' })).toHaveCount(2);
});

test('the cache browser shows stored answers and deletes on confirmation', async ({ page }) => {
  await seedWorkspace(page);
  await page.goto('/app/cache');
  await page.getByRole('button', { name: new RegExp(FRANCE.replace('?', '\\?')) }).click();
  await expect(
    page.locator('blockquote', { hasText: /Mock answer \d+ to: What is the capital of France\?/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Delete entry' }).click();
  await page
    .getByRole('group', { name: 'Delete this cached response?' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(
    page.getByRole('button', { name: new RegExp(FRANCE.replace('?', '\\?')) }),
  ).toHaveCount(0);
});
