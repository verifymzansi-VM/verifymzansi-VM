"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ImagePlus, X, Film } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/heic",
  "image/heif",
];
const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
/** HEIC/HEIF are accepted by the file-picker but converted client-side to JPEG before upload. */
const HEIC_TYPES = new Set(["image/heic", "image/heif"]);
const ALL_ACCEPT = [...IMAGE_TYPES, ...VIDEO_TYPES].join(",");
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_VIDEO_SIZE = 50 * 1024 * 1024; // 50 MB

/** Map MIME types to a canonical extension for files missing one (e.g. Android content-picker). */
const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/avif": ".avif",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
};

/**
 * Lazily convert a HEIC/HEIF blob to JPEG using heic2any.
 * Returns the converted File or null on failure.
 */
async function convertHeicToJpeg(file: File): Promise<File | null> {
  try {
    const heic2any = (await import("heic2any")).default;
    const blob = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
    const result = Array.isArray(blob) ? blob[0] : blob;
    const baseName = file.name.replace(/\.[^.]+$/, "") || file.name;
    return new File([result], `${baseName}.jpg`, {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  } catch {
    return null;
  }
}

/** Ensure the file has a proper extension; Android content-picker files are often extensionless. */
function normalizeFileName(file: File): File {
  if (file.name.includes(".")) return file;
  const ext = MIME_TO_EXT[file.type];
  if (!ext) return file;
  return new File([file], file.name + ext, { type: file.type, lastModified: file.lastModified });
}

/**
 * Read a File into a stable in-memory copy so Android scoped-storage can't
 * revoke the handle later.  Retries once after a short delay because some
 * Android browsers need a tick after the picker closes before the content
 * URI becomes readable.
 */
async function stabiliseFile(file: File): Promise<File | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const buf = await file.arrayBuffer();
      return new File([buf], file.name, {
        type: file.type,
        lastModified: file.lastModified,
      });
    } catch {
      if (attempt === 0) {
        // Give Android a moment to settle
        await new Promise((r) => setTimeout(r, 120));
      }
    }
  }
  return null;
}

interface MediaUploadProps {
  /** Stable id used to associate label, hint, error, and input */
  id?: string;
  /** Label shown above the upload area */
  label?: string;
  /** Helper text shown under the label */
  description?: string;
  /** Inline error shown under the upload control */
  error?: string;
  /** Human label for accepted types, overriding the default generated copy */
  acceptedLabel?: string;
  /** Recommended crop/aspect guidance */
  recommendedAspect?: string;
  /** Human label for the max file size */
  maxSizeLabel?: string;
  /** Called when files are rejected client-side */
  onRejectedFiles?: (messages: string[]) => void;
  /** Maximum number of files allowed */
  maxFiles?: number;
  /** Currently selected files */
  files: File[];
  /** Callback when files change */
  onChange: (files: File[]) => void;
  /** Optional specific accepted file types, e.g. "image/*" */
  accept?: string;
  /** If true, disables the upload dropzone and file input */
  disabled?: boolean;
}

interface PreviewItem {
  file: File;
  url: string;
  isVideo: boolean;
}

export function MediaUpload({
  id,
  label = "Photos & Videos",
  description,
  error,
  acceptedLabel,
  recommendedAspect = "Recommended: 1080x1920 portrait (9:16)",
  maxSizeLabel,
  onRejectedFiles,
  maxFiles = 10,
  files,
  onChange,
  accept,
  disabled = false,
}: MediaUploadProps) {
  const generatedId = useId();
  const inputId = id ?? `media-upload-${generatedId}`;
  const descriptionId = `${inputId}-description`;
  const countId = `${inputId}-count`;
  const rejectedId = `${inputId}-rejected`;
  const errorId = `${inputId}-error`;
  const [isDragOver, setIsDragOver] = useState(false);
  const [failedPreviews, setFailedPreviews] = useState<Set<number>>(new Set());
  const [rejectedMessages, setRejectedMessages] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // Derive previews from files — no setState-in-effect needed
  const previews = useMemo<PreviewItem[]>(
    () =>
      files.map((file) => ({
        file,
        url: URL.createObjectURL(file),
        isVideo: VIDEO_TYPES.includes(file.type),
      })),
    [files]
  );

  // Clean up blob URLs when previews change
  useEffect(() => {
    return () => {
      previews.forEach((p) => URL.revokeObjectURL(p.url));
    };
  }, [previews]);

  const validateAndAdd = useCallback(
    async (incoming: FileList | File[]) => {
      if (disabled) return;

      const valid: File[] = [];
      const rejected: string[] = [];
      const incomingArr = Array.from(incoming);

      const rejectFile = (title: string, description: string) => {
        rejected.push(description);
        toast({
          title,
          description,
          variant: "destructive",
        });
      };

      for (const file of incomingArr) {
        // If specific accept is passed (e.g. image/*) do a loose check, else strict check
        if (accept && accept.startsWith("image/") && !IMAGE_TYPES.includes(file.type)) {
          rejectFile(
            "Unsupported file type",
            `"${file.name}" is not supported. Use JPG, PNG, WebP, GIF, or AVIF images up to 5 MB.`
          );
          continue;
        } else if (accept && accept.startsWith("video/") && !VIDEO_TYPES.includes(file.type)) {
          rejectFile(
            "Unsupported file type",
            `"${file.name}" is not supported. Use MP4, WebM, or MOV videos up to 50 MB.`
          );
          continue;
        } else if (!accept && ![...IMAGE_TYPES, ...VIDEO_TYPES].includes(file.type)) {
          rejectFile(
            "Unsupported file type",
            `"${file.name}" is not supported. Use JPG, PNG, WebP, GIF, or AVIF images, or MP4, WebM, or MOV videos.`
          );
          continue;
        }

        // Check size
        const isVideo = VIDEO_TYPES.includes(file.type);
        const maxSize = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
        if (file.size > maxSize) {
          rejectFile(
            "File too large",
            `"${file.name}" exceeds the ${isVideo ? "50 MB video" : "5 MB image"} limit.`
          );
          continue;
        }

        // Read file into a stable in-memory copy so Android scoped-storage
        // can't revoke the handle later, and normalize extensionless filenames.
        const stable = await stabiliseFile(normalizeFileName(file));
        if (!stable) {
          rejectFile(
            "Could not read file",
            `"${file.name}" is no longer accessible. Please re-select it.`
          );
          continue;
        }
        let normalized = stable;

        // Convert HEIC/HEIF → JPEG client-side (iOS camera default format)
        if (HEIC_TYPES.has(normalized.type)) {
          const converted = await convertHeicToJpeg(normalized);
          if (!converted) {
            rejectFile(
              "Conversion failed",
              `"${file.name}" could not be converted. Please save it as JPEG and try again.`
            );
            continue;
          }
          // Re-check size after HEIC→JPEG conversion (JPEG is usually larger)
          if (converted.size > MAX_IMAGE_SIZE) {
            rejectFile(
              "File too large",
              `"${file.name}" exceeds the 5 MB image limit after conversion.`
            );
            continue;
          }
          normalized = converted;
        }

        valid.push(normalized);
      }

      // Enforce max count
      const total = files.length + valid.length;
      if (total > maxFiles) {
        rejectFile(
          "Too many files",
          `You can upload at most ${maxFiles} files. ${total - maxFiles} file(s) were not added.`
        );
      }

      const allowed = valid.slice(0, maxFiles - files.length);
      if (allowed.length > 0) {
        onChange([...files, ...allowed]);
      }
      setRejectedMessages(rejected.slice(-4));
      if (rejected.length > 0) {
        onRejectedFiles?.(rejected);
      }
    },
    [accept, files, maxFiles, onChange, onRejectedFiles, toast, disabled]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      if (disabled) return;
      if (e.dataTransfer.files.length > 0) {
        void validateAndAdd(e.dataTransfer.files);
      }
    },
    [validateAndAdd, disabled]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (disabled) return;
      if (e.target.files && e.target.files.length > 0) {
        void validateAndAdd(e.target.files);
        // Reset so the same file can be re-selected
        e.target.value = "";
      }
    },
    [validateAndAdd, disabled]
  );

  const removeFile = useCallback(
    (index: number) => {
      const next = files.filter((_, i) => i !== index);
      onChange(next);
    },
    [files, onChange]
  );

  const remaining = maxFiles - files.length;
  const defaultAcceptedLabel = accept?.startsWith("video/")
    ? "Videos (MP4, WebM) up to 50 MB"
    : accept?.startsWith("image/")
      ? "Images (JPG, PNG, WebP, GIF, AVIF, HEIC) up to 5 MB"
      : "Images (JPG, PNG, WebP, GIF, AVIF, HEIC) up to 5 MB; videos (MP4, WebM) up to 50 MB";
  const describedBy = [
    description ? descriptionId : null,
    countId,
    rejectedMessages.length > 0 ? rejectedId : null,
    error ? errorId : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="space-y-2">
      <label
        htmlFor={inputId}
        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
      >
        {label}
      </label>
      {description && (
        <p id={descriptionId} className="text-xs text-muted-foreground">
          {description}
        </p>
      )}

      {/* Preview grid */}
      {previews.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {previews.map((item, idx) => (
            <div
              key={`${item.file.name}-${idx}`}
              className="relative group aspect-[9/16] rounded-lg overflow-hidden border bg-muted"
            >
              {item.isVideo ? (
                <div className="relative w-full h-full">
                  <video
                    src={item.url}
                    className="w-full h-full object-cover"
                    muted
                    playsInline
                    preload="metadata"
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                    <Film className="h-6 w-6 text-white" />
                  </div>
                </div>
              ) : failedPreviews.has(idx) ? (
                <div className="w-full h-full flex flex-col items-center justify-center gap-1 p-2 text-center">
                  <ImagePlus className="h-5 w-5 text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground leading-tight">
                    Preview unavailable
                  </span>
                  <span className="text-[9px] text-muted-foreground/70 leading-tight truncate max-w-full">
                    {`Preview unavailable for "${item.file.name}"`}
                  </span>
                </div>
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/no-noninteractive-element-interactions */
                <img
                  src={item.url}
                  alt={item.file.name}
                  className="w-full h-full object-cover"
                  width={200}
                  height={200}
                  onError={() => setFailedPreviews((prev) => new Set(prev).add(idx))}
                />
              )}
              {idx === 0 && previews.length > 1 && (
                <span className="absolute bottom-1 left-1 rounded bg-brand-green/90 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-sm">
                  Main
                </span>
              )}
              <button
                type="button"
                onClick={() => removeFile(idx)}
                className="absolute top-1 right-1 rounded-full bg-black/60 p-1 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/80"
                aria-label={`Remove ${item.file.name}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Drop zone */}
      {remaining > 0 && (
        <div
          role="button"
          tabIndex={0}
          aria-describedby={describedBy || undefined}
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled) setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          onClick={() => {
            if (!disabled) inputRef.current?.click();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (!disabled) inputRef.current?.click();
            }
          }}
          className={cn(
            "border-2 border-dashed rounded-lg p-4 text-center transition-colors",
            disabled ? "opacity-50 cursor-not-allowed border-muted" : "cursor-pointer",
            isDragOver && !disabled
              ? "border-brand-green bg-brand-green/5"
              : !disabled
                ? "border-muted-foreground/25 hover:border-brand-green/50"
                : ""
          )}
        >
          {accept?.startsWith("video/") ? (
            <Film className="h-6 w-6 mx-auto mb-1.5 text-muted-foreground" />
          ) : (
            <ImagePlus className="h-6 w-6 mx-auto mb-1.5 text-muted-foreground" />
          )}
          <p className="text-sm font-medium text-muted-foreground">
            {disabled ? "Uploads disabled for your current plan" : "Drag & drop or click to browse"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {acceptedLabel ?? defaultAcceptedLabel}
            {maxSizeLabel ? `; ${maxSizeLabel}` : ""}
          </p>
          <p id={countId} className="text-xs text-muted-foreground mt-0.5">
            {files.length} selected. {remaining} of {maxFiles} remaining.
          </p>
          {recommendedAspect && (
            <p className="text-[10px] text-muted-foreground/70 mt-1.5">{recommendedAspect}</p>
          )}

          <input
            id={inputId}
            ref={inputRef}
            type="file"
            accept={accept || ALL_ACCEPT}
            multiple={maxFiles > 1}
            disabled={disabled}
            onChange={handleFileInput}
            className="hidden"
            aria-label="Upload photos and videos"
            aria-describedby={describedBy || undefined}
            aria-invalid={Boolean(error) || undefined}
          />
        </div>
      )}
      {rejectedMessages.length > 0 && (
        <div
          id={rejectedId}
          className="rounded-md border border-destructive/30 bg-destructive/5 p-2"
        >
          <p className="text-xs font-medium text-destructive">Some files were not added</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-destructive">
            {rejectedMessages.map((message, index) => (
              <li key={`${message}-${index}`}>{message}</li>
            ))}
          </ul>
        </div>
      )}
      {error && (
        <p id={errorId} className="inline-form-error">
          {error}
        </p>
      )}
    </div>
  );
}
