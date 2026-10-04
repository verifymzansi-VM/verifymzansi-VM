import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";

async function csrf(page: Page) {
  const response = await page.request.get("/api/csrf");
  expect(response.ok()).toBeTruthy();
  return { "x-csrf-token": (await response.json()).token };
}
async function session(page: Page, persona: string) {
  const response = await page.goto(`/api/e2e/auth/session?persona=${persona}&reset=1`);
  expect(response?.status()).toBe(200);
}
function syntheticSaId(isMobile: boolean, variant = 0) {
  const partial = `800101${(isMobile ? 5010 : 5009) + variant * 2}08`;
  let total = 0;
  for (let index = 0; index < partial.length; index++) {
    let digit = Number(partial[index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    total += digit;
  }
  return partial + String((10 - (total % 10)) % 10);
}

test("authenticated synthetic document submission, private evidence and independent reviewer resubmission", async ({
  page,
  browser,
  isMobile,
}) => {
  const suffix = isMobile ? "mobile" : "desktop";
  const member = `kyc-member-${suffix}`;
  await session(page, member);
  expect(
    (
      await page.request.post("/api/e2e/verification", {
        data: { action: "prepare_kyc", persona: member },
      })
    ).ok()
  ).toBeTruthy();
  const memberHeaders = await csrf(page);
  const start = await page.request.post("/api/verification/session/start", {
    headers: memberHeaders,
  });
  expect(start.status(), await start.text()).toBe(200);

  const pixels = Buffer.alloc(640 * 400 * 3);
  for (let index = 0; index < pixels.length; index++)
    pixels[index] = (index * 31 + Math.floor(index / 640) * 17) % 256;
  const image = await sharp(pixels, { raw: { width: 640, height: 400, channels: 3 } })
    .png()
    .toBuffer();
  const upload = await page.request.post("/api/verification/upload", {
    headers: memberHeaders,
    multipart: {
      docType: "id_document",
      idDocumentType: "sa_id",
      idNumber: syntheticSaId(isMobile),
      firstName: "Synthetic",
      lastName: "Member",
      captureMethod: "file_upload",
      file: { name: "synthetic-document.png", mimeType: "image/png", buffer: image },
    },
  });
  expect(upload.status(), await upload.text()).toBe(200);
  const { artifactId } = await upload.json();
  expect(artifactId).toMatch(/^[a-f0-9-]{36}$/);
  const denied = await page.request.get(
    `/api/admin/verification/evidence?artifactId=${artifactId}`
  );
  expect(denied.status()).toBe(403);
  const snapshot = await page.request.post("/api/e2e/verification", {
    data: { action: "snapshot", persona: member },
  });
  const step = (await snapshot.json()).steps.find(
    (entry: { step_type: string }) => entry.step_type === "id_doc"
  );
  expect(step.status).toBe("pending");

  const reviewerContext = await browser.newContext();
  try {
    const reviewer = await reviewerContext.newPage();
    const reviewerPersona = `kyc-reviewer-${suffix}`;
    await session(reviewer, reviewerPersona);
    const headers = await csrf(reviewer);
    const evidence = await reviewer.request.get(
      `/api/admin/verification/evidence?artifactId=${artifactId}`
    );
    expect(evidence.status(), await evidence.text()).toBe(200);
    expect(evidence.headers()["cache-control"]).toContain("no-store");
    expect(await evidence.body()).toEqual(image);
    const unclaimed = await reviewer.request.post("/api/admin/verification/decide", {
      headers,
      data: {
        stepId: step.id,
        decision: "needs_resubmission",
        reasonCode: "blurry_image",
        reasonNote: "Synthetic reviewer requests a clearer image.",
      },
    });
    expect(unclaimed.status(), await unclaimed.text()).toBe(409);
    expect((await unclaimed.json()).code).toBe("claim_required");
    const claim = await reviewer.request.post("/api/e2e/verification", {
      data: { action: "claim", persona: reviewerPersona, stepId: step.id },
    });
    expect(claim.status(), await claim.text()).toBe(200);
    const decision = await reviewer.request.post("/api/admin/verification/decide", {
      headers,
      data: {
        stepId: step.id,
        decision: "needs_resubmission",
        reasonCode: "blurry_image",
        reasonNote: "Synthetic reviewer requests a clearer image.",
        expectedUpdatedAt: step.updated_at,
      },
    });
    expect(decision.status(), await decision.text()).toBe(200);
    const status = await page.request.get("/api/verification/status");
    const result = await status.json();
    expect(
      result.steps.find((entry: { step_type: string }) => entry.step_type === "id_doc").status
    ).toBe("needs_resubmission");
    expect(JSON.stringify(result)).not.toContain(syntheticSaId(isMobile));
    await page.goto("/verification");
    await expect(page.getByRole("heading", { name: /step 2: id details/i })).toBeVisible();
  } finally {
    await reviewerContext.close();
  }
});

async function submitIdentity(page: Page, isMobile: boolean, variant: number) {
  const headers = await csrf(page);
  expect(
    (await page.request.post("/api/verification/session/start", { headers })).ok()
  ).toBeTruthy();
  for (const [index, docType] of ["id_document", "selfie"].entries()) {
    const pixels = Buffer.alloc(640 * 400 * 3);
    for (let pixel = 0; pixel < pixels.length; pixel++)
      pixels[pixel] =
        (pixel * (31 + index * 6) + variant * 41 + Math.floor(pixel / 640) * 17) % 256;
    const image = await sharp(pixels, { raw: { width: 640, height: 400, channels: 3 } })
      .png()
      .toBuffer();
    const response = await page.request.post("/api/verification/upload", {
      headers,
      multipart: {
        docType,
        captureMethod: "file_upload",
        ...(docType === "id_document"
          ? {
              idDocumentType: "sa_id",
              idNumber: syntheticSaId(isMobile, variant),
              firstName: "Synthetic",
              lastName: "Member",
            }
          : {}),
        file: { name: `synthetic-${docType}.png`, mimeType: "image/png", buffer: image },
      },
    });
    expect(response.status(), await response.text()).toBe(200);
  }
  const location = await page.request.post("/api/verification/location/manual", {
    headers,
    data: { province: "Gauteng", city: "Johannesburg" },
  });
  expect(location.status(), await location.text()).toBe(200);
}
async function snapshot(page: Page, persona: string) {
  const response = await page.request.post("/api/e2e/verification", {
    data: { action: "snapshot", persona },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}
async function review(
  page: Page,
  persona: string,
  memberPage: Page,
  member: string,
  stepType: string,
  riskLevel: "low" | "high"
) {
  const state = await snapshot(memberPage, member);
  const step = state.steps.find((row: { step_type: string }) => row.step_type === stepType);
  for (const data of [
    {
      action: "set_risk",
      persona,
      stepId: step.id,
      riskLevel,
      riskScore: riskLevel === "high" ? 80 : 10,
    },
    { action: "claim", persona, stepId: step.id },
  ]) {
    const response = await page.request.post("/api/e2e/verification", { data });
    expect(response.status(), await response.text()).toBe(200);
  }
  const fresh = (await snapshot(memberPage, member)).steps.find(
    (row: { step_type: string }) => row.step_type === stepType
  );
  return page.request.post("/api/admin/verification/decide", {
    headers: await csrf(page),
    data: {
      stepId: step.id,
      decision: "approved",
      expectedUpdatedAt: fresh.updated_at,
      ...(riskLevel === "high"
        ? {
            overrideReasonCode: "verified_in_person",
            reasonNote: "Synthetic original evidence reviewed.",
          }
        : {}),
    },
  });
}
async function expectVerified(page: Page, persona: string) {
  const state = await snapshot(page, persona);
  expect(state.profile.account_verification_status).toBe("verified");
  expect(state.profile.display_name).toBe("Synthetic Member");
  expect(state.profile.legal_name_locked_at).toBeTruthy();
  for (const type of ["id_doc", "selfie"]) {
    expect(state.steps.find((row: { step_type: string }) => row.step_type === type)).toMatchObject({
      status: "approved",
      reviewed_by: expect.any(String),
      reviewed_at: expect.any(String),
    });
  }
  expect(state.artifacts).toHaveLength(2);
  for (const artifact of state.artifacts) {
    expect(artifact.status).toBe("approved");
    expect(Date.parse(artifact.purge_after)).toBeGreaterThan(Date.now() + 28 * 86400000);
  }
  await page.goto("/verification");
  await expect(page.getByRole("heading", { name: "You're verified" })).toBeVisible();
}

test("synthetic selfie and ordinary manual approvals complete verification, lock the legal name and schedule retention", async ({
  page,
  browser,
  isMobile,
}) => {
  const suffix = isMobile ? "mobile" : "desktop";
  const member = `kyc-member-complete-${suffix}`;
  await session(page, member);
  expect(
    (
      await page.request.post("/api/e2e/verification", {
        data: { action: "prepare_kyc", persona: member },
      })
    ).ok()
  ).toBeTruthy();
  await submitIdentity(page, isMobile, 1);
  const context = await browser.newContext();
  try {
    const reviewer = await context.newPage();
    const persona = `kyc-reviewer-complete-${suffix}`;
    await session(reviewer, persona);
    for (const type of ["id_doc", "selfie"]) {
      const response = await review(reviewer, persona, page, member, type, "low");
      expect(response.status(), await response.text()).toBe(200);
    }
    await expectVerified(page, member);
  } finally {
    await context.close();
  }
});

test("high-risk approval stays pending until an independent governor approves through the governance UI", async ({
  page,
  browser,
  isMobile,
}) => {
  const suffix = isMobile ? "mobile" : "desktop";
  const member = `kyc-member-high-${suffix}`;
  await session(page, member);
  expect(
    (
      await page.request.post("/api/e2e/verification", {
        data: { action: "prepare_kyc", persona: member },
      })
    ).ok()
  ).toBeTruthy();
  await submitIdentity(page, isMobile, 2);
  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
    browser.newContext(),
  ]);
  try {
    const [proposer, approver, moderator] = await Promise.all(
      contexts.map((context) => context.newPage())
    );
    const proposerPersona = `kyc-governor-proposer-${suffix}`;
    await session(proposer, proposerPersona);
    await session(approver, `kyc-governor-approver-${suffix}`);
    await session(moderator, `kyc-reviewer-limited-${suffix}`);
    const selfie = await review(proposer, proposerPersona, page, member, "selfie", "low");
    expect(selfie.status(), await selfie.text()).toBe(200);
    const proposal = await review(proposer, proposerPersona, page, member, "id_doc", "high");
    expect(proposal.status(), await proposal.text()).toBe(202);
    const { decisionId } = await proposal.json();
    expect((await snapshot(page, member)).profile.account_verification_status).not.toBe("verified");
    const decision = {
      action: "approve",
      decisionId,
      payloadVersion: 1,
      rationale: "Synthetic independent review.",
    };
    const own = await proposer.request.post("/api/admin/governance/decide", {
      headers: await csrf(proposer),
      data: decision,
    });
    expect(own.status(), await own.text()).toBe(403);
    expect((await own.json()).code).toBe("not_independent");
    const limited = await moderator.request.post("/api/admin/governance/decide", {
      headers: await csrf(moderator),
      data: decision,
    });
    expect(limited.status()).toBe(403);
    const denied = await page.request.post("/api/admin/governance/decide", {
      headers: await csrf(page),
      data: decision,
    });
    expect(denied.status()).toBe(403);
    const stale = await approver.request.post("/api/admin/governance/decide", {
      headers: await csrf(approver),
      data: { ...decision, payloadVersion: 2 },
    });
    expect(stale.status(), await stale.text()).toBe(409);
    expect((await stale.json()).code).toBe("payload_changed");
    await proposer.goto(`/admin/governance/escalations/${decisionId}`);
    await expect(proposer.getByRole("button", { name: "Withdraw proposal" })).toBeVisible();
    await expect(proposer.getByRole("button", { name: "Approve and apply" })).toHaveCount(0);
    await approver.goto(`/admin/governance/escalations/${decisionId}`);
    await expect(approver.getByRole("heading", { name: "Decision: kyc_override" })).toBeVisible();
    await approver.getByLabel("Rationale", { exact: true }).fill("Synthetic independent review.");
    const approved = approver.waitForResponse(
      (response) =>
        response.url().includes("/api/admin/governance/decide") &&
        response.request().method() === "POST"
    );
    await approver.getByRole("button", { name: "Approve and apply" }).click();
    const response = await approved;
    expect(response.status(), await response.text()).toBe(200);
    await expect(
      approver.getByText("Synthetic independent review.", { exact: true })
    ).toBeVisible();
    await expectVerified(page, member);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
