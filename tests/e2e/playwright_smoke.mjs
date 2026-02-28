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

test("compare view renders and signature capture can be accepted", async ({ page }) => {
  await page.goto("http://127.0.0.1:5000/");

  await page.locator("#markdown-editor").click();
  await page.locator("#markdown-editor").press("End");
  await page.locator("#markdown-editor").type("\n- Playwright diff marker");
  await page.getByRole("button", { name: "New Revision" }).click();

  await page.locator("#markdown-editor").click();
  await page.locator("#markdown-editor").press("End");
  await page.locator("#markdown-editor").type("\n- Revision two marker");

  await page.selectOption("#compare-base", { label: "Revision 1" });
  await page.selectOption("#compare-target", { label: "Revision 2" });
  await page.getByRole("button", { name: "Compare" }).click();
  await expect(page.locator("#compare-output")).toContainText("Revision 1 vs Revision 2");

  await page.getByRole("button", { name: "Sign as Consultant" }).click();
  await page.fill("#signature-name", "Playwright Consultant");
  const canvas = page.locator("#signature-canvas");
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error("signature canvas not visible");
  }
  await page.mouse.move(box.x + 20, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + 90, { steps: 8 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Accept Signature" }).click();

  await expect(page.locator("#signature-modal")).toBeHidden();
  await expect(page.locator("#preview-content")).toContainText("Playwright Consultant");
});
