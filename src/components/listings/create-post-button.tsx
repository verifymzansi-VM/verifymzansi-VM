"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Megaphone, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

type PostTypeOption = { value: string; label: string };

const STOREFRONT_POST_TYPES: PostTypeOption[] = [
  { value: "update", label: "Update" },
  { value: "promotion", label: "Promotion" },
  { value: "event", label: "Event" },
];

const BUSINESS_POST_TYPES: PostTypeOption[] = [
  { value: "update", label: "Update" },
  { value: "case_study", label: "Case Study" },
  { value: "offer", label: "Offer" },
  { value: "hiring", label: "Hiring" },
];

interface CreatePostButtonProps {
  /** Parent entity ID (storefront or business profile) */
  entityId: string;
  /** Which type of entity this post belongs to */
  entityType: "storefront" | "business";
  /** Whether the parent entity is in a live/active state */
  isLive: boolean;
}

export function CreatePostButton({ entityId, entityType, isLive }: CreatePostButtonProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [postType, setPostType] = useState("update");

  const postTypes = entityType === "storefront" ? STOREFRONT_POST_TYPES : BUSINESS_POST_TYPES;
  const apiPath =
    entityType === "storefront"
      ? `/api/storefronts/${entityId}/posts`
      : `/api/business-ads/${entityId}/posts`;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (title.length < 3) {
      toast({ title: "Title must be at least 3 characters", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(apiPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          body: body || undefined,
          post_type: postType,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast({ title: data.error || "Failed to create post", variant: "destructive" });
        return;
      }

      toast({ title: "Post created successfully!" });
      setOpen(false);
      setTitle("");
      setBody("");
      setPostType("update");
      router.refresh();
    } catch {
      toast({ title: "Something went wrong", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  if (!isLive) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1">
          <Megaphone className="h-3 w-3" />
          Post
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create a Post</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="post-type">Type</Label>
            <select
              id="post-type"
              value={postType}
              onChange={(e) => setPostType(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {postTypes.map((pt) => (
                <option key={pt.value} value={pt.value}>
                  {pt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="post-title">Title</Label>
            <Input
              id="post-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What's the announcement?"
              maxLength={120}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="post-body">Details (optional)</Label>
            <Textarea
              id="post-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Add more details about your post..."
              maxLength={entityType === "business" ? 5000 : 3000}
              rows={4}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || title.length < 3}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  Creating…
                </>
              ) : (
                "Publish Post"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
