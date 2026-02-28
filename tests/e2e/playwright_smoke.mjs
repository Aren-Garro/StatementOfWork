/**
 * Local smoke flow for the SOW creator.
 *
 * Run manually (requires Playwright):
 *   npx playwright test tests/e2e/playwright_smoke.mjs
 */
import { test, expect } from "@playwright/test";

async function drawSignature(page) {
  const canvas = page.locator("#signature-canvas");
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error("signature canvas not visible");
  }
  await page.mouse.move(box.x + 20, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + 90, { steps: 8 });
  await page.mouse.up();
}

test("local-first signing and export controls render", async ({ page }) => {
  await page.goto("http://127.0.0.1:5000/");

  await expect(page.getByRole("button", { name: "Sign as Consultant" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign as Client" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New Revision" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export .json" })).toBeVisible();

  await page.fill('input[data-var="project_name"]', "Playwright Smoke SOW");
  await expect(page.locator("#doc-name")).toContainText("Playwright Smoke SOW");

  await expect(page.locator("#guardrail-list")).toBeVisible();
  await expect(page.locator(".sow-gantt")).toBeVisible();
});

test("new library, compare, and signature modal controls render", async ({ page }) => {
  await page.goto("http://127.0.0.1:5000/");

  await expect(page.locator("#library-search")).toBeVisible();
  await expect(page.locator("#library-industry")).toBeVisible();
  await expect(page.locator("#library-list")).toBeVisible();
  await expect(page.locator("#custom-clause-select")).toBeVisible();
  await expect(page.locator("#custom-clause-name")).toBeVisible();
  await expect(page.locator("#custom-clause-body")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save Clause" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Insert Clause" })).toBeVisible();

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

  await page.locator("#revision-list button").first().click();
  await expect(page.locator("#compare-output")).toContainText("Revision 1 vs Revision 2");

  await page.getByRole("button", { name: "Sign as Consultant" }).click();
  await page.fill("#signature-name", "Playwright Consultant");
  await drawSignature(page);
  await page.getByRole("button", { name: "Accept Signature" }).click();

  await expect(page.locator("#signature-modal")).toBeHidden();
  await expect(page.locator("#preview-content")).toContainText("Playwright Consultant");
});

test("template library apply-new-doc and full signing flow update status", async ({ page }) => {
  await page.goto("http://127.0.0.1:5000/");

  const initialDocCount = await page.locator("#doc-list button").count();
  const firstCard = page.locator("#library-list .library-item").first();
  await expect(firstCard).toBeVisible();
  const firstTitle = (await firstCard.locator("h3").textContent())?.trim() || "Untitled SOW";
  await firstCard.getByRole("button", { name: "Apply New Doc" }).click();

  await expect(page.locator("#doc-name")).toContainText(firstTitle);
  await expect(page.locator("#doc-list button")).toHaveCount(initialDocCount + 1);

  await page.getByRole("button", { name: "Sign as Consultant" }).click();
  await page.fill("#signature-name", "Consultant Smoke");
  await drawSignature(page);
  await page.getByRole("button", { name: "Accept Signature" }).click();

  await page.getByRole("button", { name: "Sign as Client" }).click();
  await page.fill("#signature-name", "Client Smoke");
  await drawSignature(page);
  await page.getByRole("button", { name: "Accept Signature" }).click();

  await expect(page.locator("#doc-status")).toContainText("signed");
  await expect(page.locator("#save-status")).toContainText("Signed revisions are locked");
});

test("pricing block renders subtotal discount tax and total summary", async ({ page }) => {
  await page.goto("http://127.0.0.1:5000/");

  const pricingMarkdown = [
    ":::pricing",
    "| Item | Hours | Rate | Total |",
    "|---|---:|---:|---:|",
    "| Discovery | 2 | $100 | $200 |",
    "| Build | 3 | $100 | $300 |",
    "Discount: 10%",
    "Tax: 8%",
    ":::",
  ].join("\n");
  await page.fill("#markdown-editor", pricingMarkdown);

  await expect(page.locator("#preview-content")).toContainText("Subtotal:");
  await expect(page.locator("#preview-content")).toContainText("Discount (10%)");
  await expect(page.locator("#preview-content")).toContainText("Tax (8%)");
  await expect(page.locator("#preview-content")).toContainText("Total:");
});
