import { expect, it, vi } from "vitest";
import { settleMediaUploads } from "./settle-media-uploads";

it("does not allow a retry to overlap uploads still running after another file fails", async () => {
  let finish!: (value: string) => void;
  const pending = new Promise<string>((resolve) => {
    finish = resolve;
  });
  const onError = vi.fn();
  const failure = new Error("Photo failed");
  const attempt = settleMediaUploads([Promise.reject(failure), pending]).catch(onError);
  await Promise.resolve();
  await Promise.resolve();
  expect(onError).not.toHaveBeenCalled();
  finish("video-url");
  await attempt;
  expect(onError).toHaveBeenCalledWith(failure);
});

it("preserves file order even when uploads finish in reverse order", async () => {
  let finish!: (value: string) => void;
  const first = new Promise<string>((resolve) => {
    finish = resolve;
  });
  const result = settleMediaUploads([first, Promise.resolve("second")]);
  finish("first");
  await expect(result).resolves.toEqual(["first", "second"]);
});
