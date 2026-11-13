import { test, expect } from "@playwright/test";

test("development retires a previously installed caching worker without deleting unrelated storage", async ({
  page,
  context,
}) => {
  const origin = "http://localhost:3002";
  // Emulate the worker installed before development-mode recovery existed.
  await context.route(`${origin}/sw.js`, (route) =>
    route.fulfill({
      contentType: "application/javascript",
      headers: { "Service-Worker-Allowed": "/" },
      body: `self.addEventListener('install', () => self.skipWaiting()); self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));`,
    }),
  );
  await context.route(`${origin}/pwa-fixture`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Previous app shell</title><p>Previous app shell</p>",
    }),
  );
  await page.goto(`${origin}/pwa-fixture`);
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    await (
      await caches.open("tc-shell-v021")
    ).put("/_next/static/stale.js", new Response("stale"));
    await (
      await caches.open("unrelated-app")
    ).put("/unrelated", new Response("keep"));
    localStorage.setItem("pwa-recovery-sentinel", "keep");
  });
  await context.unroute(`${origin}/sw.js`);
  // Updating the existing script must retrieve the development recovery worker.
  await page
    .evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration("/");
      await registration!.update();
    })
    .catch(() => {
      /* recovery navigates this page */
    });
  await expect
    .poll(() =>
      page
        .evaluate(async () => (await caches.keys()).includes("tc-shell-v021"))
        .catch(() => true),
    )
    .toBe(false);
  await expect
    .poll(() =>
      page.evaluate(
        async () => (await navigator.serviceWorker.getRegistrations()).length,
      ),
    )
    .toBe(0);
  expect(
    await page.evaluate(async () =>
      (await caches.keys()).includes("unrelated-app"),
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() => localStorage.getItem("pwa-recovery-sentinel")),
  ).toBe("keep");
  await page.goto(`${origin}/login`);
  await expect(
    page.getByRole("button", { name: "Send Verification Code" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      async () => (await navigator.serviceWorker.getRegistrations()).length,
    ),
  ).toBe(0);
});

test("sign-in displays OTP throttling as a helpful message", async ({
  page,
}) => {
  await page.route("**/api/v1/auth/otp/request", (route) =>
    route.fulfill({
      status: 429,
      contentType: "application/problem+json",
      body: JSON.stringify({
        status: 429,
        code: "RATE_LIMITED",
        detail: "Too many OTP requests. Try again later.",
      }),
    }),
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://localhost:3002/login");
  await page
    .getByLabel("Work email or Indian mobile number (+91)")
    .fill("user@example.test");
  await page.getByRole("button", { name: "Send Verification Code" }).click();
  await expect(
    page.getByText("Too many verification code requests. Try again later."),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
