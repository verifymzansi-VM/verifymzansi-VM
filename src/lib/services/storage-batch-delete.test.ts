/** @vitest-environment node */
// The real AWS SDK client (serialisation, checksum, retries and XML parsing)
// with a stub request handler in place of the network, so the batch delete is
// checked against the replies the SDK actually produces.
import { Readable } from "node:stream";
import type * as S3 from "@aws-sdk/client-s3";
import { beforeEach, describe, expect, it, vi } from "vitest";

type StubReply = { status: number; body: string };
type SeenRequest = {
  method: string;
  hostname: string;
  path: string;
  query: Record<string, unknown>;
  headers: Record<string, string>;
  body: unknown;
};
const stub = vi.hoisted(() => ({
  reply: (): StubReply => ({ status: 200, body: "" }),
  seen: [] as SeenRequest[],
}));

vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const real = await importOriginal<typeof S3>();
  class StubbedS3Client extends real.S3Client {
    constructor(config: ConstructorParameters<typeof real.S3Client>[0]) {
      super({
        ...config,
        requestHandler: {
          async handle(request: SeenRequest) {
            stub.seen.push(request);
            const { status, body } = stub.reply();
            return {
              response: {
                statusCode: status,
                headers: { "content-type": "application/xml" },
                body: Readable.from([Buffer.from(body)]),
              },
            };
          },
        } as never,
      });
    }
  }
  return { ...real, S3Client: StubbedS3Client };
});

import { deleteManyFromR2 } from "./storage";

const keys = ["media/a", "media/a.w400.webp", "media/a.w800.webp"];
const xml = (inner: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${inner}</DeleteResult>`;
const deleted = (key: string) => `<Deleted><Key>${key}</Key></Deleted>`;
const failed = (key: string | null, code: string) =>
  `<Error>${key === null ? "" : `<Key>${key}</Key>`}<Code>${code}</Code><Message>x</Message></Error>`;

beforeEach(() => {
  stub.seen.length = 0;
  process.env.R2_ACCOUNT_ID = "stub-account";
  process.env.R2_ACCESS_KEY_ID = "stub-access";
  process.env.R2_SECRET_ACCESS_KEY = "stub-value";
});

describe("deleteManyFromR2 with the real S3 client", () => {
  it("sends one non-quiet DeleteObjects request naming every key", async () => {
    stub.reply = () => ({ status: 200, body: xml(keys.map(deleted).join("")) });
    expect(await deleteManyFromR2("my-bucket", keys)).toEqual([]);
    expect(stub.seen).toHaveLength(1);
    const [request] = stub.seen;
    expect(request!.method).toBe("POST");
    expect(`${request!.hostname}${request!.path}`).toContain("my-bucket");
    expect(request!.query).toHaveProperty("delete");
    const body = String(request!.body);
    for (const key of keys) expect(body).toContain(`<Key>${key}</Key>`);
    expect(body).toContain("<Quiet>false</Quiet>");
    // What R2 receives for integrity: the SDK's CRC32 header, not Content-MD5.
    expect(Object.keys(request!.headers)).toContain("x-amz-checksum-crc32");
  });

  it("confirms only keys the reply lists as deleted", async () => {
    stub.reply = () => ({ status: 200, body: xml(deleted("media/a")) });
    expect(await deleteManyFromR2("my-bucket", keys)).toEqual([
      "media/a.w400.webp",
      "media/a.w800.webp",
    ]);
  });

  it("counts NoSuchKey as deleted and any other key error as not deleted", async () => {
    stub.reply = () => ({
      status: 200,
      body: xml(
        deleted("media/a") +
          failed("media/a.w400.webp", "NoSuchKey") +
          failed("media/a.w800.webp", "AccessDenied")
      ),
    });
    expect(await deleteManyFromR2("my-bucket", keys)).toEqual(["media/a.w800.webp"]);
  });

  it("does not confirm a key reported both deleted and refused", async () => {
    stub.reply = () => ({
      status: 200,
      body: xml(keys.map(deleted).join("") + failed("media/a", "InternalError")),
    });
    expect(await deleteManyFromR2("my-bucket", keys)).toEqual(["media/a"]);
  });

  it.each([
    ["an empty 200", ""],
    ["an HTML 200", "<html><body>ok</body></html>"],
    ["a quiet-style empty result", xml("")],
    ["a reply about other keys only", xml(deleted("media/other"))],
  ])("refuses %s instead of confirming anything", async (_, body) => {
    stub.reply = () => ({ status: 200, body });
    const failure = await deleteManyFromR2("my-bucket", keys).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    // Not a busy reply: the caller falls back to single deletes.
    expect(failure).not.toHaveProperty("retryLater");
  });

  it.each([
    ["no key", failed(null, "InternalError")],
    ["a key that was not requested", deleted("media/a") + failed("media/other", "AccessDenied")],
  ])("refuses a reply with an error naming %s", async (_, inner) => {
    stub.reply = () => ({ status: 200, body: xml(inner) });
    await expect(deleteManyFromR2("my-bucket", keys)).rejects.toThrow(
      "Storage batch reply names a key that was not requested"
    );
  });

  it.each([
    ["a 503 SlowDown", { status: 503, body: "<Error><Code>SlowDown</Code></Error>" }],
    ["a 500", { status: 500, body: "<Error><Code>InternalError</Code></Error>" }],
    [
      "an error document with status 200",
      { status: 200, body: "<Error><Code>InternalError</Code><Message>x</Message></Error>" },
    ],
  ])("reports %s as busy after exactly one request", async (_, reply) => {
    stub.reply = () => reply;
    await expect(deleteManyFromR2("my-bucket", keys)).rejects.toMatchObject({
      retryLater: true,
    });
    expect(stub.seen).toHaveLength(1);
  });
});
