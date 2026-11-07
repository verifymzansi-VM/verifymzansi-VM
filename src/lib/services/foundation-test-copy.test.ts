import { mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Test-only paths for the local foundation test copy (roadmap M0.7): local file
// storage and the fake SMS sink. They must switch on only for that copy and
// stay off with production settings, whatever else is set.

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));
vi.mock("@aws-sdk/client-s3", () => {
  class Command {
    constructor(public params: unknown) {}
  }
  return {
    S3Client: class {
      send = mockSend;
    },
    PutObjectCommand: Command,
    DeleteObjectCommand: Command,
    GetObjectCommand: Command,
    HeadObjectCommand: Command,
  };
});

const COPY = {
  NODE_ENV: "production",
  ENVIRONMENT: "test",
  VERIFYMZANSI_RUNTIME_MODE: "e2e",
  PLAYWRIGHT_TEST_MODE: "1",
  NEXT_PUBLIC_DATA_BACKEND: "foundation",
  FOUNDATION_PROJECT_REF: "local-foundation",
  FOUNDATION_SUPABASE_URL: "http://127.0.0.1:55443",
  PLAYWRIGHT_SUPABASE_MODE: "",
  R2_ACCOUNT_ID: "test-account",
  R2_ACCESS_KEY_ID: "test-access",
  R2_SECRET_ACCESS_KEY: "test-secret",
};
const PRODUCTION_CHANGES: [string, Record<string, string>][] = [
  ["production environment", { ENVIRONMENT: "production" }],
  ["no e2e runtime", { VERIFYMZANSI_RUNTIME_MODE: "" }],
  ["test mode off", { PLAYWRIGHT_TEST_MODE: "" }],
  ["the London project", { FOUNDATION_PROJECT_REF: "gntzjtuncsyefujajmjy" }],
  ["a hosted connection", { FOUNDATION_SUPABASE_URL: "https://gntzjtuncsyefujajmjy.supabase.co" }],
  ["a non-loopback connection", { FOUNDATION_SUPABASE_URL: "http://10.0.0.5:55443" }],
  ["the retired backend", { NEXT_PUBLIC_DATA_BACKEND: "source" }],
];

function stubEnv(values: Record<string, string>) {
  vi.stubGlobal("window", undefined);
  vi.stubGlobal("document", undefined);
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
}

let workdir: string | undefined;
function useTemporaryCwd() {
  workdir = mkdtempSync(path.join(tmpdir(), "vm-test-copy-"));
  vi.spyOn(process, "cwd").mockReturnValue(workdir);
  return workdir;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
  mockSend.mockReset();
  if (workdir) rmSync(workdir, { recursive: true, force: true });
  workdir = undefined;
});

describe("isPlaywrightFoundationCopy", () => {
  it("is on for the local foundation test copy", async () => {
    stubEnv(COPY);
    const { isPlaywrightFoundationCopy } = await import("@/lib/supabase/playwright-mode");
    expect(isPlaywrightFoundationCopy()).toBe(true);
  });

  for (const [label, change] of PRODUCTION_CHANGES)
    it(`is off with ${label}`, async () => {
      stubEnv({ ...COPY, ...change });
      const { isPlaywrightFoundationCopy } = await import("@/lib/supabase/playwright-mode");
      expect(isPlaywrightFoundationCopy()).toBe(false);
    });

  it("is off in the browser", async () => {
    stubEnv(COPY);
    vi.stubGlobal("window", {});
    const { isPlaywrightFoundationCopy } = await import("@/lib/supabase/playwright-mode");
    expect(isPlaywrightFoundationCopy()).toBe(false);
  });
});

describe("local file storage", () => {
  it("reads local files instead of R2 in the test copy", async () => {
    stubEnv(COPY);
    useTemporaryCwd();
    const { getR2ObjectSize } = await import("./storage");
    await expect(getR2ObjectSize("verifymzansi-public", "media/missing")).resolves.toBeNull();
    expect(mockSend).not.toHaveBeenCalled();
  });

  for (const [label, change] of PRODUCTION_CHANGES.slice(0, 4))
    it(`uses R2, never local files, with ${label}`, async () => {
      stubEnv({ ...COPY, ...change });
      useTemporaryCwd();
      mockSend.mockResolvedValue({ ContentLength: 7 });
      const { getR2ObjectSize } = await import("./storage");
      await expect(getR2ObjectSize("verifymzansi-public", "media/object")).resolves.toBe(7);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });
});

describe("media serve route", () => {
  const serve = async () => {
    const { GET } = await import("@/app/api/media/serve/[...key]/route");
    const { NextRequest } = await import("next/server");
    return GET(new NextRequest("http://127.0.0.1:3110/api/media/serve/media/object"), {
      params: Promise.resolve({ key: ["media", "object"] }),
    });
  };

  it("serves the copy's local media file", async () => {
    stubEnv(COPY);
    const cwd = useTemporaryCwd();
    mkdirSync(path.join(cwd, "public", "e2e-media", "media"), { recursive: true });
    writeFileSync(path.join(cwd, "public", "e2e-media", "media", "object"), "local-bytes");
    const response = await serve();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("local-bytes");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("never reads local files with production settings", async () => {
    stubEnv({ ...COPY, ENVIRONMENT: "production" });
    const cwd = useTemporaryCwd();
    mkdirSync(path.join(cwd, "public", "e2e-media", "media"), { recursive: true });
    writeFileSync(path.join(cwd, "public", "e2e-media", "media", "object"), "local-bytes");
    mockSend.mockRejectedValue(Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" }));
    const response = await serve();
    expect(mockSend).toHaveBeenCalled();
    expect(await response.text()).not.toBe("local-bytes");
  });
});

describe("fake SMS sink", () => {
  it("keeps the mock SMS for the test copy", async () => {
    stubEnv(COPY);
    const cwd = useTemporaryCwd();
    const { recordTestSms, TEST_SMS_SINK_PATH } = await import("./sms-test-sink");
    await expect(recordTestSms("+27710000000", "Your code is 123456")).resolves.toBe(true);
    const line = JSON.parse(readFileSync(path.join(cwd, ...TEST_SMS_SINK_PATH), "utf8").trim());
    expect(line).toMatchObject({ to: "+27710000000", message: "Your code is 123456" });
  });

  it("is written by the e2e mock in sendSms without calling the provider", async () => {
    stubEnv(COPY);
    const cwd = useTemporaryCwd();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { sendOtpSms } = await import("./sms");
    const { TEST_SMS_SINK_PATH } = await import("./sms-test-sink");
    await expect(sendOtpSms("+27710000001", "654321")).resolves.toMatchObject({ success: true });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(readFileSync(path.join(cwd, ...TEST_SMS_SINK_PATH), "utf8")).toContain("654321");
  });

  for (const [label, change] of PRODUCTION_CHANGES)
    it(`writes nothing with ${label}`, async () => {
      stubEnv({ ...COPY, ...change });
      const cwd = useTemporaryCwd();
      const { recordTestSms, TEST_SMS_SINK_PATH } = await import("./sms-test-sink");
      await expect(recordTestSms("+27710000000", "Your code is 123456")).resolves.toBe(false);
      expect(existsSync(path.join(cwd, ...TEST_SMS_SINK_PATH))).toBe(false);
    });
});
