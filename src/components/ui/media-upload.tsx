"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, X, Film, FileWarning } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];
const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
const ALL_ACCEPT = [...IMAGE_TYPES, ...VIDEO_TYPES].join(",");
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_VIDEO_SIZE = 50 * 1024 * 1024; // 50 MB

interface MediaUploadProps {
  /** Label shown above the upload area */
  label?: string;
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
  label = "Photos & Videos",
  maxFiles = 8,
  files,
  onChange,
  accept,
  disabled = false,
}: MediaUploadProps) {
  const [isDragOver, setIsDragOver] = useState(false);
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
    (incoming: FileList | File[]) => {
      if (disabled) return;

      const valid: File[] = [];
      const incomingArr = Array.from(incoming);

      for (const file of incomingArr) {
        // If specific accept is passed (e.g. image/*) do a loose check, else strict check
        if (accept && accept.startsWith("image/") && !IMAGE_TYPES.includes(file.type)) {
          toast({
            title: "Unsupported file type",
            description: `"${file.name}" is not a supported image format.`,
            variant: "destructive",
          });
          continue;
        } else if (accept && accept.startsWith("video/") && !VIDEO_TYPES.includes(file.type)) {
          toast({
            title: "Unsupported file type",
            description: `"${file.name}" is not a supported video format.`,
            variant: "destructive",
          });
          continue;
        } else if (!accept && ![...IMAGE_TYPES, ...VIDEO_TYPES].includes(file.type)) {
          toast({
            title: "Unsupported file type",
            description: `"${file.name}" is not a supported image or video format.`,
            variant: "destructive",
          });
          continue;
        }

        // Check size
        const isVideo = VIDEO_TYPES.includes(file.type);
        const maxSize = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
        if (file.size > maxSize) {
          toast({
            title: "File too large",
            description: `"${file.name}" exceeds the ${isVideo ? "50 MB video" : "5 MB image"} limit.`,
            variant: "destructive",
          });
          continue;
        }

        valid.push(file);
      }

      // Enforce max count
      const total = files.length + valid.length;
      if (total > maxFiles) {
        toast({
          title: "Too many files",
          description: `You can upload at most ${maxFiles} files. ${total - maxFiles} file(s) were not added.`,
          variant: "destructive",
        });
      }

      const allowed = valid.slice(0, maxFiles - files.length);
      if (allowed.length > 0) {
        onChange([...files, ...allowed]);
      }
    },
    [accept, files, maxFiles, onChange, toast, disabled]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      if (disabled) return;
      if (e.dataTransfer.files.length > 0) {
        validateAndAdd(e.dataTransfer.files);
      }
    },
    [validateAndAdd, disabled]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (disabled) return;
      if (e.target.files && e.target.files.length > 0) {
        validateAndAdd(e.target.files);
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

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
        {label}
      </label>

      {/* Preview grid */}
      {previews.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {previews.map((item, idx) => (
            <div
              key={`${item.file.name}-${idx}`}
              className="relative group aspect-square rounded-lg overflow-hidden border bg-muted"
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
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={item.url} alt={item.file.name} className="w-full h-full object-cover" />
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
            "border-2 border-dashed rounded-lg p-6 text-center transition-colors",
            disabled ? "opacity-50 cursor-not-allowed border-muted" : "cursor-pointer",
            isDragOver && !disabled
              ? "border-brand-green bg-brand-green/5"
              : !disabled
                ? "border-muted-foreground/25 hover:border-brand-green/50"
                : ""
          )}
        >
          {accept?.startsWith("video/") ? (
            <Film className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
          ) : (
            <ImagePlus className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
          )}
          <p className="text-sm font-medium text-muted-foreground">
            {disabled ? "Uploads disabled for your current plan" : "Drag & drop or click to browse"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {accept?.startsWith("video/")
              ? "Videos (MP4, MOV, WebM) up to 50 MB"
              : accept?.startsWith("image/")
                ? "Images (JPG, PNG, WebP, GIF, AVIF) up to 5 MB"
                : "Images (JPG, PNG, WebP, GIF, AVIF) up to 5 MB • Videos (MP4, MOV, WebM) up to 50 MB"}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {remaining} of {maxFiles} remaining
          </p>

          <input
            ref={inputRef}
            type="file"
            accept={accept || ALL_ACCEPT}
            multiple
            disabled={disabled}
            onChange={handleFileInput}
            className="hidden"
            aria-label="Upload photos and videos"
          />
        </div>
      )}

      {/* All slots filled message */}
      {remaining <= 0 && (
        <div className="flex items-center gap-2 text-sm text-amber-600">
          <FileWarning className="h-4 w-4" />
          <span>Maximum of {maxFiles} files reached. Remove a file to add more.</span>
        </div>
      )}
    </div>
  );
}
