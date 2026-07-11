import { expect, test } from "@playwright/test";

test.describe("Kestrel dashboard", () => {
  test("shows the supported ATS platforms", async ({ page }) => {
    await page.goto("/");

    const main = page.getByRole("main");

    await expect(page).toHaveTitle("Kestrel Job Tracker");
    await expect(
      main.getByRole("heading", { level: 1, name: "Kestrel Job Tracker" }),
    ).toBeVisible();
    await expect(
      main.getByRole("heading", { level: 2, name: "Supported ATS platforms" }),
    ).toBeVisible();
    await expect(main.getByRole("listitem")).toHaveText(["greenhouse", "lever", "ashby"]);
  });
});
