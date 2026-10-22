import { NextResponse } from "next/server";
import {
  ImageReencodeError,
  isReencodableImageType,
  reencodeImage,
} from "@/lib/utils/image-reencode";
import { inspectJpegExif, type ExifSignals } from "@/lib/utils/exif-inspect";
import { getImageDimensions } from "@/lib/utils/image-dimensions";
import { decodeImageToPixels, computeLaplacianVariance } from "@/lib/utils/blur-detection";
import { computePerceptualHash } from "@/lib/utils/perceptual-hash";
import { scanForMalware } from "@/lib/utils/malware-scan";
import { MIN_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION } from "@/lib/constants/verification";
import { validateBufferIntegrity } from "@/lib/utils/file-validation";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("VerificationUploadFileAnalysis");

type FileAnalysisResult =
  | {
      ok: true;
      fileBuffer: Buffer;
      exifSignals: ExifSignals | null;
      blurScore: number | null;
      phash: string | null;
    }
  | {
      ok: false;
      response: NextResponse;
    };

export async function analyzeKycUploadFile(params: {
  file: File;
  fileBuffer: Buffer;
  requestId: string;
  userId: string;
}): Promise<FileAnalysisResult> {
  const { file, requestId, userId } = params;
  let fileBuffer = params.fileBuffer;

  const integrity = validateBufferIntegrity(fileBuffer, file.type);
  if (!integrity.valid) {
    log.warn("File MIME mismatch detected", {
      declared: file.type,
      detected: integrity.detectedMime,
      userId,
    });
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "File type does not match its content. Please upload a valid image or document.",
          requestId,
        },
        { status: 400 }
      ),
    };
  }

  const scanResult = scanForMalware(fileBuffer, file.type);
  if (!scanResult.safe) {
    log.warn("Malware detected in KYC upload", {
      threat: scanResult.threat,
      userId,
      fileName: file.name,
    });
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            "This file was rejected because it contains suspicious content. Please upload a clean photo.",
          requestId,
        },
        { status: 400 }
      ),
    };
  }

  let exifSignals: ExifSignals | null = null;
  if (file.type === "image/jpeg" || integrity.detectedMime === "image/jpeg") {
    exifSignals = inspectJpegExif(fileBuffer);
  }

  const isImageFile = file.type.startsWith("image/");
  if (isImageFile) {
    const dims = getImageDimensions(fileBuffer);
    if (dims) {
      const shortest = Math.min(dims.width, dims.height);
      const longest = Math.max(dims.width, dims.height);
      if (shortest < MIN_IMAGE_DIMENSION) {
        return {
          ok: false,
          response: NextResponse.json(
            {
              error: `Image is too small (${dims.width}×${dims.height}). Minimum ${MIN_IMAGE_DIMENSION}px on shortest side.`,
              requestId,
            },
            { status: 400 }
          ),
        };
      }
      if (longest > MAX_IMAGE_DIMENSION) {
        return {
          ok: false,
          response: NextResponse.json(
            {
              error: `Image is too large (${dims.width}×${dims.height}). Maximum ${MAX_IMAGE_DIMENSION}px on longest side.`,
              requestId,
            },
            { status: 400 }
          ),
        };
      }
    }
  }

  let blurScore: number | null = null;
  if (isImageFile) {
    try {
      const pixels = await decodeImageToPixels(fileBuffer, file.type);
      if (pixels) {
        blurScore = computeLaplacianVariance(pixels.data, pixels.width, pixels.height);
      }
    } catch {
      // Blur detection is best-effort.
    }
  }

  let phash: string | null = null;
  if (isImageFile) {
    try {
      phash = await computePerceptualHash(fileBuffer);
    } catch {
      // Perceptual hash is best-effort.
    }
  }

  // Store only the pixels: re-encoding drops EXIF/XMP (phone photos carry GPS)
  // and anything hidden in or after the image data. Signals above were read
  // from the original first.
  if (isImageFile) {
    const mime = integrity.detectedMime ?? file.type;
    try {
      if (!isReencodableImageType(mime)) {
        throw new ImageReencodeError("undecodable", `Unsupported image type ${mime}`);
      }
      fileBuffer = Buffer.from(await reencodeImage(fileBuffer, mime));
    } catch (error) {
      const unavailable = !(error instanceof ImageReencodeError) || error.code === "unavailable";
      log.warn("KYC image re-encode refused upload", {
        userId,
        error: error instanceof Error ? error.message : "Unknown",
      });
      return {
        ok: false,
        response: NextResponse.json(
          unavailable
            ? { error: "Photo processing is busy. Please try again shortly.", requestId }
            : { error: "This photo could not be read. Please take a new photo.", requestId },
          { status: unavailable ? 503 : 400 }
        ),
      };
    }
  }

  return {
    ok: true,
    fileBuffer,
    exifSignals,
    blurScore,
    phash,
  };
}
