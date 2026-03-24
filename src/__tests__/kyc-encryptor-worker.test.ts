import { describe, expect, it, vi } from "vitest";
import kycEncryptorWorker from "../../workers/kyc-encryptor";

describe("kyc-encryptor worker", () => {
  it("rejects invalid temp keys before processing", async () => {
    const res = await kycEncryptorWorker.fetch(
      new Request("https://worker.example", {
        method: "POST",
        headers: {
          Authorization: "Bearer worker-key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tempKey: "../escape.bin",
          sellerId: "seller-1",
          artifactId: "artifact-1",
        }),
      }),
      {
        WORKER_API_KEY: "worker-key",
      } as never,
      {
        waitUntil: vi.fn(),
        passThroughOnException: vi.fn(),
      }
    );

    expect(res.status).toBe(400);
    await expect(res.text()).resolves.toBe("Invalid tempKey");
  });
});
