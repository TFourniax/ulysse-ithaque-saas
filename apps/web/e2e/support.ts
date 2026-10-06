import type { Browser, Page } from '@playwright/test';
import { expect } from '@playwright/test';

/** Logs in through the real Keycloak form with a fictional development account. */
export async function login(page: Page, username: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('link', { name: 'Se connecter' }).click();
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(`ulysse-demo-${username}`);
  await page.locator('#kc-login').click();
}

export async function newSession(browser: Browser, username: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, username);
  return page;
}

/** The initial sync runs in the background after the seed: wait until proposals appear. */
export async function waitForProposals(page: Page, count: number): Promise<void> {
  await expect(async () => {
    await page.goto('/recommendations');
    await expect(
      page.getByRole('list', { name: 'Liste des propositions' }).getByRole('listitem'),
    ).toHaveCount(count, { timeout: 2000 });
  }).toPass({ timeout: 60_000, intervals: [1000, 2000, 3000] });
}
