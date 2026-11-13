import { expect, test, type Page } from "@playwright/test";

const origin = "http://localhost:3002";
const session = {
  userId: "user-fixture",
  name: "Ananya Rao",
  orgRole: "R-OWNER",
  activeOrgId: "org-fixture",
  activeOrg: {
    display_name: "Northwind Mechanical",
    legal_name: "Northwind Mechanical Limited",
  },
};
const project = {
  id: "project-from-api",
  code: "NW-27",
  name: "Campus cooling upgrade",
  status: "ACTIVE",
  clientName: "Campus Facilities",
  mcName: "Construction partner",
  pmcName: "Design reviewer",
  city: "Pune",
  targetHandoverDate: null,
  contractValuePaise: "20000000",
  retentionAtRiskPaise: "1234567",
  approvedCount: 2,
  applicableCount: 5,
  missingCount: 2,
  inReviewCount: 1,
};
const overview = {
  org: {
    id: "org-fixture",
    displayName: "Northwind Mechanical",
    legalName: "Northwind Mechanical Limited",
  },
  user: { id: "user-fixture", name: "Ananya Rao", role: "R-OWNER" },
  kpis: {
    activeProjectsCount: 1,
    totalMissingOrExpiredCount: 2,
    awaitingMyReviewCount: 1,
    expiringSoonCount: 0,
    totalRetentionAtRiskPaise: "1234567",
  },
  projects: [project],
  needsAttention: [
    {
      requirementId: "req-fixture",
      projectId: project.id,
      projectCode: project.code,
      title: "Pump commissioning record",
      assetTag: "P-17",
      status: "CHANGES_REQUESTED",
      dueDate: "ASAP",
      ownerName: "Site team",
    },
  ],
};
async function mockWorkspace(
  page: Page,
  options: {
    role?: string;
    dashboard?: unknown;
    invoices?: unknown[];
    subscription?: unknown;
    billingError?: boolean;
    requirements?: unknown[];
  } = {},
) {
  await page
    .context()
    .addCookies([
      { name: "tc_session", value: "isolated-browser-fixture", url: origin },
    ]);
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (options.billingError && path.endsWith("/billing/invoices"))
      return route.fulfill({
        status: 500,
        contentType: "application/problem+json",
        body: JSON.stringify({ status: 500 }),
      });
    if (path === `/api/v1/projects/${project.id}/dashboard`)
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ...project,
          rowVersion: 1,
          counts: {
            applicableTotal: 5,
            approvedCount: 2,
            approvedExternalCount: 0,
            waivedCount: 0,
            inReviewCount: 1,
            missingOrExpiredCount: 2,
            expiringSoonCount: 0,
          },
        }),
      });
    if (path.endsWith("/requirements"))
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(options.requirements ?? []),
      });
    const data = path.endsWith("/auth/me")
      ? { ...session, orgRole: options.role || session.orgRole }
      : path.endsWith("/dashboard")
        ? (options.dashboard ?? overview)
        : path.endsWith("/subscription")
          ? (options.subscription ?? {
              id: null,
              planName: "No Subscription",
              status: "INACTIVE",
              seatLimit: 0,
              storageQuotaBytes: 0,
            })
          : path.endsWith("/billing/invoices")
            ? (options.invoices ?? [])
            : path.endsWith("/orgs/current")
              ? {
                  legal_name: session.activeOrg.legal_name,
                  profile: { gstin: null, pan: null },
                }
              : [];
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(data),
    });
  });
}

test("sign-in starts blank and asks people for their own account details", async ({
  page,
}) => {
  await page.goto(`${origin}/login`);
  await expect(
    page.getByLabel("Work email or Indian mobile number (+91)"),
  ).toHaveValue("");
  await expect(
    page.getByText(/Seeded Tenant|Deccan|Meera|Vikram|Persona/),
  ).toHaveCount(0);
  await page
    .getByRole("button", {
      name: "New contractor? Register a new organisation",
    })
    .click();
  await expect(
    page.getByLabel("Organisation state or union territory (Required)"),
  ).toHaveValue("");
  await page
    .getByLabel("Organisation state or union territory (Required)")
    .selectOption("MH");
});

test("overview uses current organisation and records, with real project links and no demo controls", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mockWorkspace(page);
  await page.goto(`${origin}/dashboard`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Northwind Mechanical",
  );
  await expect(page.getByText("Pump commissioning record")).toBeVisible();
  await expect(
    page.getByRole("link").filter({ hasText: "Campus cooling upgrade" }),
  ).toHaveAttribute("href", "/projects/project-from-api");
  await expect(page.getByText("Target handover: Not set")).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "40",
  );
  await expect(
    page.getByText(
      /Deccan|Meera|Vikram|qpdf|S3|128-bit|DT028|64%|Persona|Command Center/,
    ),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Billing" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("a second organisation with no projects gets an honest empty state", async ({
  page,
}) => {
  await mockWorkspace(page, {
    dashboard: {
      ...overview,
      org: { ...overview.org, displayName: "Harbour Ventilation" },
      projects: [],
      needsAttention: [],
      kpis: {
        ...overview.kpis,
        activeProjectsCount: 0,
        totalMissingOrExpiredCount: 0,
        awaitingMyReviewCount: 0,
      },
    },
  });
  await page.goto(`${origin}/dashboard`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Harbour Ventilation",
  );
  await expect(page.getByText("No projects to show yet")).toBeVisible();
  await expect(page.locator('a[href*="project-from-api"]')).toHaveCount(0);
});

test("site engineers see their role without billing or impersonation controls", async ({
  page,
}) => {
  await mockWorkspace(page, {
    role: "R-SITE",
    dashboard: { ...overview, user: { ...overview.user, role: "R-SITE" } },
  });
  await page.goto(`${origin}/dashboard`);
  await expect(
    page.getByRole("button", { name: /Ananya Rao Site engineer/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation").getByRole("link", { name: "Billing" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Persona|Switch immediately/ }),
  ).toHaveCount(0);
  await expect(page.getByText("Estimated retention:")).toHaveCount(0);
});

test("billing does not invent a subscription, tax details, or invoices", async ({
  page,
}) => {
  await mockWorkspace(page);
  await page.goto(`${origin}/billing`);
  await expect(
    page.getByText("No subscription is recorded for your organisation."),
  ).toBeVisible();
  await expect(
    page.getByText("No invoices have been issued yet."),
  ).toBeVisible();
  await expect(
    page.getByText("Northwind Mechanical Limited", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/₹9,999|4,200|AABCD4512F|GROWTH PLAN|PAID|TRACES|S3/),
  ).toHaveCount(0);
});

test("billing renders recorded zero values and issued invoice status without sample fallbacks", async ({
  page,
}) => {
  await mockWorkspace(page, {
    subscription: {
      id: "subscription-fixture",
      planName: "Pilot access",
      interval: "MONTH",
      status: "ACTIVE",
      pricePaise: 0,
      seatLimit: 0,
      maxActiveProjects: 0,
      storageQuotaBytes: 0,
    },
    invoices: [
      {
        id: "invoice-fixture",
        number: "NW/27/09",
        status: "ISSUED",
        total_paise: "0",
        tax_paise: "0",
        issued_at: "2026-11-10",
        place_of_supply: "Maharashtra",
      },
    ],
  });
  await page.goto(`${origin}/billing`);
  await expect(page.getByText("Pilot access")).toBeVisible();
  await expect(page.getByText("₹0.00 / month")).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "NW/27/09" });
  await expect(row).toContainText("Issued");
  await expect(row).toContainText("₹0.00");
  await expect(row).not.toContainText("Paid");
  await expect(page.getByText("0 GB")).toBeVisible();
});

test("a failed billing request stays an error instead of becoming fake empty success", async ({
  page,
}) => {
  await mockWorkspace(page, { billingError: true });
  await page.goto(`${origin}/billing`);
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "We could not load your billing records" }),
  ).toBeVisible();
  await expect(page.getByText("No invoices have been issued yet.")).toHaveCount(
    0,
  );
});

test("project directory searches the returned client details without invented defaults", async ({
  page,
}) => {
  await mockWorkspace(page);
  await page.goto(`${origin}/projects`);
  await page
    .getByPlaceholder("Search by project code, name, or client...")
    .fill("Campus Facilities");
  await expect(
    page.getByRole("heading", { name: "Campus cooling upgrade" }),
  ).toBeVisible();
  await expect(page.getByText("Deccan", { exact: false })).toHaveCount(0);
});

test("new requirements require explicit classifications and do not assume a due date", async ({
  page,
}) => {
  await mockWorkspace(page);
  await page.goto(`${origin}/projects/${project.id}`);
  await page
    .getByRole("button", { name: "Add Requirement", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Add Closeout Requirement" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('input[type="date"]')).toHaveValue("");
  for (const select of await dialog.locator("select").all())
    await expect(select).toHaveValue("");
  await dialog
    .locator("select")
    .first()
    .selectOption({ label: "Pressure / Hydrostatic Test Report" });
  await expect(dialog.locator("select").first()).toHaveValue("DT-033");
});

test("handover billing starts with the user’s own bill details", async ({
  page,
}) => {
  await mockWorkspace(page);
  await page.goto(`${origin}/projects/${project.id}`);
  await page
    .getByRole("button", { name: "Prepare handover package", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("Monthly RA-Bill Pack", { exact: true }).click();
  await expect(
    dialog.getByPlaceholder("Your running account bill reference"),
  ).toHaveValue("");
  await expect(
    dialog.getByPlaceholder("Amount claimed in this bill"),
  ).toHaveValue("");
  await expect(dialog.locator("select")).toHaveValue("");
});

test("workspace remains usable on a phone and a desktop", async ({
  page,
}, testInfo) => {
  await mockWorkspace(page);
  await page.goto(`${origin}/dashboard`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Northwind Mechanical",
  );
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(
      page.getByRole("link").filter({ hasText: "Campus cooling upgrade" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`overview-${width}.png`),
      fullPage: true,
    });
  }
});

test("report exports describe checklist data without implying payment release or certificate expiry", async ({
  page,
}) => {
  await mockWorkspace(page, {
    requirements: [
      {
        id: "req-insurance",
        requirementKey: "INS-01",
        title: "Contract insurance record",
        docTypeKey: "DT-004",
        status: "APPROVED",
        dueAt: "2026-12-02",
        milestoneKey: "MOBILISATION",
        mandatory: true,
        rowVersion: 3,
      },
    ],
  });
  await page.goto(`${origin}/projects/${project.id}`);
  await page.getByRole("button", { name: "Reports & Exports" }).click();
  await expect(page.getByText("Rupees unlocked", { exact: false })).toHaveCount(
    0,
  );
  const stageDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export stage progress" }).click();
  const stage = await stageDownload;
  const { readFile } = await import("node:fs/promises");
  const stageCsv = await readFile((await stage.path())!, "utf8");
  expect(stageCsv).not.toMatch(/Payment Gate|UNLOCKED|GATED/);
  expect(stageCsv).toContain("Mobilisation");
  const certificateDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export certificate list" }).click();
  const certificate = await certificateDownload;
  const certificateCsv = await readFile((await certificate.path())!, "utf8");
  expect(certificateCsv).toContain("Submission due date");
  expect(certificateCsv).not.toContain("Expiry Date");
  expect(certificateCsv).toContain("Insurance Certificate");
});
