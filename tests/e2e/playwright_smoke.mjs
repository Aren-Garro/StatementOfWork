/**
 * Local smoke flow for the SOW creator.
 *
 * Run manually (requires Playwright):
 *   npx playwright test tests/e2e/playwright_smoke.mjs
 */
import { test, expect } from "@playwright/test";

test("local-first signing and export controls render", async ({ page }) => {
  await page.goto("http://127.0.0.1:5000/");

  await expect(page.getByRole("button", { name: "Sign as Consultant" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign as Client" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New Revision" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export .json" })).toBeVisible();

  await page.fill('input[data-var="project_name"]', "Playwright Smoke SOW");
  await expect(page.locator("#doc-name")).toContainText("Playwright Smoke SOW");

  await expect(page.locator("#guardrail-list")).toBeVisible();
});

test("new library, compare, and signature modal controls render", async ({ page }) => {
  await page.goto("http://127.0.0.1:5000/");

  await expect(page.locator("#library-search")).toBeVisible();
  await expect(page.locator("#library-industry")).toBeVisible();
  await expect(page.locator("#library-list")).toBeVisible();

  await expect(page.locator("#compare-base")).toBeVisible();
  await expect(page.locator("#compare-target")).toBeVisible();
  await expect(page.getByRole("button", { name: "Compare" })).toBeVisible();

  await page.getByRole("button", { name: "Sign as Consultant" }).click();
  await expect(page.locator("#signature-modal")).toBeVisible();
  await expect(page.locator("#signature-canvas")).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept Signature" })).toBeVisible();

  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator("#signature-modal")).toBeHidden();
});
