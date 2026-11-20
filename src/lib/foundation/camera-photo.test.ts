import { describe, expect, it } from "vitest";
import { cameraPhotoProblem, MIN_ID_LONG_EDGE, readJpegFacts } from "./camera-photo";
import { cameraJpeg } from "@/test/fixtures/camera-jpeg";

describe("camera photo checks", () => {
  it("reads the size of the page's canvas JPEG and finds no EXIF block", () => {
    expect(readJpegFacts(cameraJpeg({ width: 1920, height: 1080 }))).toEqual({
      width: 1920,
      height: 1080,
      exif: false,
    });
    expect(cameraPhotoProblem(cameraJpeg(), "id_front")).toBeNull();
    expect(cameraPhotoProblem(cameraJpeg({ width: 960, height: 1280 }), "selfie")).toBeNull();
  });

  it("refuses what the page never sends", () => {
    expect(cameraPhotoProblem(cameraJpeg({ exif: true }), "id_front")).toBe("has_exif");
    expect(cameraPhotoProblem(cameraJpeg({ exif: true }), "selfie")).toBe("has_exif");
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(cameraPhotoProblem(png, "id_front")).toBe("not_jpeg");
    expect(cameraPhotoProblem(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]), "selfie")).toBe(
      "unreadable"
    );
  });

  it("refuses an ID photo too small to read, but not a small selfie", () => {
    const small = cameraJpeg({ width: MIN_ID_LONG_EDGE - 1, height: 600 });
    expect(cameraPhotoProblem(small, "id_front")).toBe("too_small");
    expect(cameraPhotoProblem(small, "selfie")).toBeNull();
    expect(
      cameraPhotoProblem(cameraJpeg({ width: 600, height: MIN_ID_LONG_EDGE }), "id_front")
    ).toBeNull();
  });
});
