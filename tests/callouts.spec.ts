import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { RenderResult } from "../src/types";

const fixtures = JSON.parse(readFileSync(new URL("./fixtures/rendered.json", import.meta.url), "utf8"));
const source: string = fixtures.samples.callouts;
const rendered: RenderResult = fixtures.results.callouts;

for (const [variant, scheme] of [["modern", "light"], ["classic", "dark"]] as const) {
  test(`${variant}/${scheme}: callouts retain styles, nested content and native collapse`, async ({ page }) => {
    await page.goto("/tests/preview.html");
    await page.waitForFunction(() => typeof (window as any).renderResult === "function");
    await page.evaluate(async ({ source, rendered, variant, scheme }) => {
      document.documentElement.dataset.theme = scheme;
      rendered.theme!.variant = variant;
      await (window as any).renderResult(rendered, source);
    }, { source, rendered: structuredClone(rendered), variant, scheme });

    const frame = page.frameLocator("iframe");
    for (const kind of ["note", "tip", "important", "warning", "caution"]) {
      const callout = frame.locator(`article > .admonition.${kind}`).first();
      await expect(callout).toBeVisible();
      await expect(callout.locator(":scope > .admonition-title")).toHaveText(kind[0].toUpperCase() + kind.slice(1));
      const style = await callout.locator(".admonition-title").evaluate(element => ({
        icon: getComputedStyle(element, "::before").maskImage,
        iconWidth: parseFloat(getComputedStyle(element, "::before").width),
      }));
      expect(style.icon).not.toBe("none");
      expect(style.iconWidth).toBeGreaterThan(0);
    }
    const open = frame.locator("details.tip");
    const closed = frame.locator("details.warning");
    await expect(open).toHaveAttribute("open", "");
    await expect(open.locator("summary strong")).toHaveText("标题");
    await expect(open.locator("p")).toBeVisible();
    await expect(closed).not.toHaveAttribute("open");
    await expect(closed.locator("p")).toBeHidden();
    await closed.locator("summary").click();
    await expect(closed.locator("p")).toBeVisible();
    await open.locator("summary").click();
    await expect(open.locator("p")).toBeHidden();

    await expect(frame.locator(".admonition.note > .admonition.tip > p").last()).toHaveText("重复段落。");
    await expect(frame.locator(".admonition.example li")).toHaveText("列表项目");
    await expect(frame.locator(".admonition.example pre code")).toContainText('print("Callout")');
    await expect(frame.locator("article > blockquote")).toHaveCount(2);
    expect(await page.evaluate(() => (window as any).warnings)).toEqual([]);

    // The unchanged document reuses its nodes, including the reader's choices.
    await page.evaluate(async ({ source, rendered, variant }) => {
      rendered.theme!.variant = variant;
      await (window as any).renderResult(rendered, source);
    }, { source, rendered: structuredClone(rendered), variant });
    await expect(open.locator("p")).toBeHidden();
    await expect(closed.locator("p")).toBeVisible();
  });
}

test("callout settings default on, persist both switches and translate", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-action="settings"]').first().click();
  await page.locator('[data-settings-tab="extensions"]').click();
  const toggle = page.locator('[data-extension="pymdownx.quotes"]');
  const group = toggle.locator("..").locator("..");
  await expect(toggle).toBeChecked();
  await expect(group).toContainText("GitHub / Obsidian 提示框");
  await group.locator("summary").click();
  const callouts = page.locator('[data-extension-option="pymdownx.quotes"][data-option="callouts"]');
  await expect(callouts).toBeChecked();
  await callouts.uncheck();
  await toggle.uncheck();
  await expect(callouts).toBeDisabled();
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await page.reload();
  await page.locator('[data-action="settings"]').first().click();
  await page.locator('[data-settings-tab="extensions"]').click();
  await expect(toggle).not.toBeChecked();
  await group.locator("summary").click();
  await expect(callouts).not.toBeChecked();
  await toggle.check();
  await expect(callouts).toBeEnabled();
  await page.locator('[data-settings-tab="appearance"]').click();
  await page.locator("#language-choice").selectOption("en");
  await page.locator('[data-settings-tab="extensions"]').click();
  await expect(group).toContainText("GitHub / Obsidian callouts");
  await expect(group).toContainText("Recognize callouts");
});
