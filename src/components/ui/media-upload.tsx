"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Film, ImagePlus, Play, Plus, RefreshCw, Trash2, X } from "lucide-react";
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
const VIDEO_URL_PATTERN = /\.(mp4|webm|ogg|mov)(?:[?#]|$)/i;

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

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Already-uploaded media shown alongside newly picked files (edit forms). */
export interface ExistingMediaItem {
  url: string;
  /** Defaults to a file-extension check on the URL */
  isVideo?: boolean;
  /** Accessible name, e.g. "Photo 2" */
  label?: string;
}

export type MediaPreviewShape = "square" | "portrait" | "wide";

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
  /** Maximum number of items allowed, counting `existing` items */
  maxFiles?: number;
  /** Currently selected (not yet uploaded) files */
  files: File[];
  /** Callback when files change */
  onChange: (files: File[]) => void;
  /** Optional specific accepted file types, e.g. "image/*" */
  accept?: string;
  /** If true, disables the upload dropzone and file input */
  disabled?: boolean;
  /** Already-saved media, shown first in the same grid */
  existing?: ExistingMediaItem[];
  /** Remove a saved item; the remove button is hidden when omitted */
  onRemoveExisting?: (index: number) => void;
  /** Thumbnail shape. Defaults to square. Use "wide" for banners. */
  previewShape?: MediaPreviewShape;
}

type Tile =
  | { kind: "existing"; key: string; url: string; isVideo: boolean; name: string; index: number }
  | {
      kind: "file";
      key: string;
      url: string;
      isVideo: boolean;
      name: string;
      file: File;
      index: number;
    };

const SHAPE_CLASS: Record<MediaPreviewShape, string> = {
  square: "aspect-square",
  portrait: "aspect-[4/5]",
  wide: "aspect-[16/9]",
};

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
  existing = [],
  onRemoveExisting,
  previewShape = "square",
}: MediaUploadProps) {
  const generatedId = useId();
  const inputId = id ?? `media-upload-${generatedId}`;
  const descriptionId = `${inputId}-description`;
  const countId = `${inputId}-count`;
  const rejectedId = `${inputId}-rejected`;
  const errorId = `${inputId}-error`;
  const [isDragOver, setIsDragOver] = useState(false);
  const [failedPreviews, setFailedPreviews] = useState<Set<string>>(new Set());
  const [rejectedMessages, setRejectedMessages] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const isSingleFileMode = maxFiles === 1;
  const isVideoOnly = accept?.startsWith("video/") ?? false;
  const isImageOnly = accept?.startsWith("image/") ?? false;
  const noun = isVideoOnly ? "video" : isImageOnly ? "photo" : "photo or video";
  const pluralNoun = isVideoOnly ? "videos" : isImageOnly ? "photos" : "photos or videos";

  // Derive previews from files — no setState-in-effect needed
  const filePreviews = useMemo(
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
      filePreviews.forEach((p) => URL.revokeObjectURL(p.url));
    };
  }, [filePreviews]);

  const tiles = useMemo<Tile[]>(
    () => [
      ...existing.map((item, index) => ({
        kind: "existing" as const,
        key: `existing-${item.url}`,
        url: item.url,
        isVideo: item.isVideo ?? VIDEO_URL_PATTERN.test(item.url),
        name: item.label ?? `${isVideoOnly ? "Video" : "Photo"} ${index + 1}`,
        index,
      })),
      ...filePreviews.map((item, index) => ({
        kind: "file" as const,
        key: `file-${item.url}`,
        url: item.url,
        isVideo: item.isVideo,
        name: item.file.name,
        file: item.file,
        index,
      })),
    ],
    [existing, filePreviews, isVideoOnly]
  );

  // In a single slot a freshly picked file supersedes the saved one.
  const singleTile = tiles.find((tile) => tile.kind === "file") ?? tiles[0];
  const totalCount = isSingleFileMode
    ? Math.min(1, existing.length + files.length)
    : existing.length + files.length;
  const remaining = Math.max(0, maxFiles - totalCount);
  // A single-file slot can always be swapped for a new pick.
  const canAdd = !disabled && maxFiles > 0 && (remaining > 0 || isSingleFileMode);

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

      // Enforce max count (saved items count toward the limit)
      const existingFiles = isSingleFileMode ? [] : files;
      const capacity = Math.max(0, maxFiles - existing.length - existingFiles.length);
      const slots = isSingleFileMode ? maxFiles : capacity;
      if (valid.length > slots) {
        rejectFile(
          "Too many files",
          `You can add at most ${maxFiles} ${maxFiles === 1 ? noun : pluralNoun}. ${valid.length - slots} file(s) were not added.`
        );
      }

      const allowed = valid.slice(0, slots);
      if (allowed.length > 0) {
        onChange([...existingFiles, ...allowed]);
      }
      setRejectedMessages(rejected.slice(-4));
      if (rejected.length > 0) {
        onRejectedFiles?.(rejected);
      }
    },
    [
      accept,
      existing.length,
      files,
      isSingleFileMode,
      maxFiles,
      noun,
      onChange,
      onRejectedFiles,
      pluralNoun,
      toast,
      disabled,
    ]
  );

  const openPicker = useCallback(() => {
    if (!disabled) inputRef.current?.click();
  }, [disabled]);

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
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    },
    [files, onChange]
  );

  const removeTile = (tile: Tile) => {
    if (tile.kind === "file") removeFile(tile.index);
    else onRemoveExisting?.(tile.index);
  };

  const defaultAcceptedLabel = isVideoOnly
    ? "Videos (MP4, WebM, MOV) up to 50 MB"
    : isImageOnly
      ? "Images (JPG, PNG, WebP, GIF, AVIF, HEIC) up to 5 MB"
      : "Images (JPG, PNG, WebP, GIF, AVIF, HEIC) up to 5 MB; videos (MP4, WebM, MOV) up to 50 MB";
  const guidance = [acceptedLabel ?? defaultAcceptedLabel, maxSizeLabel].filter(Boolean).join("; ");
  const describedBy = [
    description ? descriptionId : null,
    countId,
    rejectedMessages.length > 0 ? rejectedId : null,
    error ? errorId : null,
  ]
    .filter(Boolean)
    .join(" ");

  const dragHandlers = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      if (!disabled) setIsDragOver(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setIsDragOver(false);
    },
    onDrop: handleDrop,
  };

  const renderMedia = (tile: Tile, fit: "cover" | "contain" = "cover") => {
    const fitClass = fit === "cover" ? "object-cover" : "object-contain";
    if (tile.isVideo) {
      return (
        <div className="relative h-full w-full bg-black">
          <video
            src={tile.url}
            className={cn("h-full w-full", fitClass)}
            muted
            playsInline
            preload="metadata"
          />
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white">
              <Play className="h-4 w-4 translate-x-px fill-current" aria-hidden="true" />
            </span>
          </span>
        </div>
      );
    }
    if (failedPreviews.has(tile.key)) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center">
          <ImagePlus className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <span className="text-[11px] leading-tight text-muted-foreground">
            Preview unavailable
          </span>
          <span className="sr-only">{`Preview unavailable for "${tile.name}"`}</span>
        </div>
      );
    }
    return (
      /* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/no-noninteractive-element-interactions */
      <img
        src={tile.url}
        alt={tile.name}
        className={cn("h-full w-full", fitClass)}
        width={200}
        height={200}
        onError={() => setFailedPreviews((prev) => new Set(prev).add(tile.key))}
      />
    );
  };

  const uploadIcon = isVideoOnly ? (
    <Film className="h-5 w-5" aria-hidden="true" />
  ) : (
    <ImagePlus className="h-5 w-5" aria-hidden="true" />
  );

  return (
    <div className="space-y-2" {...dragHandlers}>
      <div className="flex items-start justify-between gap-3">
        <label
          htmlFor={inputId}
          className="block text-sm font-semibold leading-snug text-foreground"
        >
          {label}
        </label>
        {!isSingleFileMode && maxFiles > 0 && (
          <span
            className={cn(
              "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums",
              totalCount > 0
                ? "bg-brand-green-100 text-brand-green-800 dark:bg-brand-green-900/40 dark:text-brand-green-200"
                : "bg-muted text-muted-foreground"
            )}
            aria-hidden="true"
          >
            {totalCount} / {maxFiles}
          </span>
        )}
      </div>
      {description && (
        <p id={descriptionId} className="text-xs leading-5 text-muted-foreground">
          {description}
        </p>
      )}
      <p id={countId} className="sr-only">
        {totalCount} of {maxFiles} added. {remaining} remaining.
      </p>

      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept={accept || ALL_ACCEPT}
        multiple={maxFiles > 1}
        disabled={disabled}
        onChange={handleFileInput}
        className="sr-only"
        tabIndex={-1}
        aria-describedby={describedBy || undefined}
        aria-invalid={Boolean(error) || undefined}
      />

      {tiles.length === 0 ? (
        /* ── Empty: one obvious place to click or drop ── */
        <button
          type="button"
          disabled={disabled || maxFiles <= 0}
          onClick={openPicker}
          aria-describedby={describedBy || undefined}
          className={cn(
            "flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-4 py-6 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none",
            disabled || maxFiles <= 0
              ? "cursor-not-allowed border-border bg-muted/40 opacity-60"
              : isDragOver
                ? "border-brand-green-500 bg-brand-green-50 dark:bg-brand-green-950/40"
                : "border-border bg-muted/30 hover:border-brand-green-500/60 hover:bg-brand-green-50/50 dark:hover:bg-brand-green-950/20",
            error && !isDragOver && "border-destructive/60"
          )}
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-green-600 text-white shadow-sm">
            {uploadIcon}
          </span>
          <span className="text-sm font-semibold text-foreground">
            {disabled
              ? "Uploads disabled for your current plan"
              : isSingleFileMode
                ? `Add ${noun}`
                : `Add ${pluralNoun}`}
          </span>
          {!disabled && (
            <span className="text-xs text-muted-foreground">
              Tap to choose from your device, or drag {isSingleFileMode ? "it" : "them"} here
            </span>
          )}
          <span className="text-xs text-muted-foreground">{guidance}</span>
          {recommendedAspect && (
            <span className="text-xs text-muted-foreground">{recommendedAspect}</span>
          )}
        </button>
      ) : isSingleFileMode ? (
        /* ── Single slot (logo, cover, video): preview + clear actions ── */
        <div
          className={cn(
            "flex flex-col gap-3 rounded-2xl border bg-card p-3 sm:flex-row sm:items-center",
            isDragOver ? "border-brand-green-500" : "border-border",
            error && "border-destructive/60"
          )}
        >
          <div
            className={cn(
              "relative shrink-0 overflow-hidden rounded-xl border border-border bg-muted",
              previewShape === "wide" ? "aspect-[16/9] w-full sm:w-48" : "h-24 w-24",
              previewShape === "portrait" && "aspect-[4/5] h-auto w-24"
            )}
          >
            {renderMedia(singleTile, previewShape === "square" ? "contain" : "cover")}
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {singleTile.kind === "file" ? singleTile.name : `Current ${noun}`}
              </p>
              <p className="text-xs text-muted-foreground">
                {singleTile.kind === "file"
                  ? `${formatFileSize(singleTile.file.size)} · ready to upload`
                  : "Saved"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={disabled}
                onClick={openPicker}
                aria-label={`Change ${singleTile.name}`}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-input bg-background px-3.5 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Change
              </button>
              {(singleTile.kind === "file" || onRemoveExisting) && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => removeTile(singleTile)}
                  aria-label={`Remove ${singleTile.name}`}
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-destructive/30 bg-background px-3.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* ── Gallery: thumbnails with always-visible remove + an "Add" tile ── */
        <div
          className={cn(
            "rounded-2xl border p-2 transition-colors motion-reduce:transition-none",
            isDragOver
              ? "border-brand-green-500 bg-brand-green-50/60 dark:bg-brand-green-950/30"
              : "border-border bg-muted/20",
            error && !isDragOver && "border-destructive/60"
          )}
        >
          <ul
            className={cn(
              "grid gap-2",
              previewShape === "wide" ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-3 sm:grid-cols-4"
            )}
          >
            {tiles.map((tile, position) => (
              <li
                key={tile.key}
                className={cn(
                  "relative overflow-hidden rounded-xl border border-border bg-muted",
                  SHAPE_CLASS[previewShape]
                )}
              >
                {renderMedia(tile)}
                {position === 0 && tiles.length > 1 && (
                  <span className="absolute bottom-1.5 left-1.5 rounded-full bg-brand-green-700 px-2 py-0.5 text-[11px] font-semibold text-white shadow-sm">
                    Cover
                  </span>
                )}
                {tile.kind === "file" && existing.length > 0 && (
                  <span className="absolute left-1.5 top-1.5 rounded-full bg-black/65 px-2 py-0.5 text-[10px] font-semibold text-white">
                    New
                  </span>
                )}
                {(tile.kind === "file" || onRemoveExisting) && (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => removeTile(tile)}
                    className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-black/70 text-white shadow-sm transition-colors hover:bg-brand-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-50"
                    aria-label={`Remove ${tile.name}`}
                    title="Remove"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
            {canAdd && (
              <li className={SHAPE_CLASS[previewShape]}>
                <button
                  type="button"
                  onClick={openPicker}
                  aria-describedby={describedBy || undefined}
                  className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border bg-background text-center text-foreground transition-colors hover:border-brand-green-500/70 hover:bg-brand-green-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-brand-green-950/20 motion-reduce:transition-none"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-green-600 text-white">
                    <Plus className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="text-xs font-semibold">Add more</span>
                  <span className="text-[11px] text-muted-foreground">{remaining} left</span>
                </button>
              </li>
            )}
          </ul>
          <p className="px-1 pt-2 text-xs text-muted-foreground">
            {remaining === 0
              ? `Limit reached. Remove one to add another.`
              : tiles.length > 1
                ? `First ${isVideoOnly ? "video" : "photo"} is the cover. ${guidance}.`
                : guidance}
          </p>
        </div>
      )}

      {rejectedMessages.length > 0 && (
        <div
          id={rejectedId}
          className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2"
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
