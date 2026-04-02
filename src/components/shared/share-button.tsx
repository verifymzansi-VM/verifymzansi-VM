"use client";

import { useState, useRef, useEffect } from "react";
import { Share2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface ShareButtonProps {
  title: string;
  text?: string;
  url?: string;
  variant?: "ghost" | "outline" | "default";
  size?: "sm" | "default" | "icon";
  className?: string;
}

export function ShareButton({
  title,
  text,
  url,
  variant = "ghost",
  size = "sm",
  className,
}: ShareButtonProps) {
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const { toast } = useToast();

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  async function handleShare() {
    const shareUrl = url || (typeof window !== "undefined" ? window.location.href : "");
    const shareData = {
      title,
      text: text || title,
      url: shareUrl,
    };

    // Try Web Share API first (mobile & supported browsers)
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch (err) {
        // User cancelled or share failed — fall through to clipboard
        if ((err as Error).name === "AbortError") return;
      }
    }

    // Fallback: copy to clipboard
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast({ title: "Link copied to clipboard!", variant: "success" });
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: "Could not copy link",
        description: "Please copy the URL from your browser's address bar.",
        variant: "destructive",
      });
    }
  }

  return (
    <Button
      variant={variant}
      size={size}
      className={`gap-1.5 ${className || ""}`}
      onClick={handleShare}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-brand-green" />
      ) : (
        <Share2 className="h-3.5 w-3.5" />
      )}
      {size !== "icon" && (copied ? "Copied!" : "Share")}
    </Button>
  );
}
