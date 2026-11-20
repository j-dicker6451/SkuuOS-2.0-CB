// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Playwright smoke: bulk part → Formulation & method tab inside the record layout.
 *
 *   BASE_URL=http://localhost:3000 \
 *   SKUU_PART_ITEM_ID=item_… \
 *   pnpm exec playwright test test/e2e/part-formulation-tab.spec.ts
 */
import { expect, test } from "@playwright/test";

const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
const bulkItemId =
  process.env.SKUU_PART_ITEM_ID ?? "item_EL64Jer7rGqUo2jN7a7GHq";
const devEmail = process.env.DEV_BYPASS_EMAIL ?? "test@carbon.ms";

test.describe("part formulation tab", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${baseUrl}/login`);
    await page.getByLabel(/email/i).fill(devEmail);
    await page.getByRole("button", { name: /sign in|continue|log in/i }).click();
    await page.waitForURL((url) => !url.pathname.endsWith("/login"), {
      timeout: 120_000
    });
  });

  test("renders formulation content with record chrome", async ({ page }) => {
    await page.goto(`${baseUrl}/x/part/${bulkItemId}/formulation`);

    await expect(
      page.getByRole("heading", { name: /Formulation & method/i })
    ).toBeVisible({ timeout: 60_000 });

    const formulationTab = page.getByRole("link", {
      name: /Formulation & method/i
    });
    await expect(formulationTab).toBeVisible();

    await expect(page.getByText(/Manufacturing|Used In/i).first()).toBeVisible();
  });
});