import Link from "next/link";
import Image from "next/image";
import { Pencil, Eye, ArrowRight, Package } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { normalizeMediaUrl } from "@/lib/utils/media-url";

export interface RecentPost {
  id: string;
  title: string | null;
  status: string;
  photos?: string[] | null;
  view_count?: number | null;
  created_at: string;
}

interface MyRecentPostsProps {
  posts: RecentPost[];
}

const statusConfig: Record<string, { label: string; className: string }> = {
  live: {
    label: "Live",
    className:
      "bg-brand-green-50 text-brand-green border-brand-green-200 dark:bg-brand-green-950 dark:border-brand-green-800",
  },
  pending_moderation: {
    label: "Pending",
    className:
      "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:border-amber-800",
  },
  flagged_for_review: {
    label: "Under Review",
    className:
      "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:border-amber-800",
  },
  rejected: {
    label: "Rejected",
    className: "bg-red-50 text-red-600 border-red-200 dark:bg-red-950 dark:border-red-800",
  },
  draft: {
    label: "Draft",
    className: "bg-warm-100 text-warm-600 border-warm-200 dark:bg-warm-800 dark:border-warm-700",
  },
  expired: {
    label: "Expired",
    className: "bg-warm-100 text-warm-500 border-warm-200 dark:bg-warm-800 dark:border-warm-700",
  },
};

function getRelativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days < 1) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
}

export function MyRecentPosts({ posts }: MyRecentPostsProps) {
  if (posts.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-display">Continue where you left off</CardTitle>
          <p className="text-sm text-muted-foreground">
            Your latest listings are here so you can jump back in without searching.
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <Package className="h-8 w-8 mb-2 opacity-20" />
            <p className="text-sm font-medium">No posts yet</p>
            <p className="text-xs mt-0.5">Create a listing to start getting leads</p>
            <Button asChild size="sm" className="mt-4">
              <Link href="/post/create">Post Your First Ad</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <CardTitle className="text-base font-display">Continue where you left off</CardTitle>
            <p className="text-sm text-muted-foreground">
              Open a recent listing, review its status, or make quick edits.
            </p>
          </div>
          <Button asChild variant="ghost" size="sm" className="text-xs gap-1">
            <Link href="/dashboard/listings">
              Manage Listings
              <ArrowRight className="h-3 w-3" />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-0">
        <ul className="divide-y" aria-label="Your recent posts">
          {posts.map((post) => {
            const status = statusConfig[post.status] ?? statusConfig.draft;
            const thumbnail = post.photos?.[0] ? normalizeMediaUrl(post.photos[0]) : null;
            const title = post.title?.slice(0, 50) || "Untitled";

            return (
              <li key={post.id} className="flex items-center gap-3 px-6 py-3">
                {/* Thumbnail */}
                <div className="w-12 h-12 rounded-lg bg-warm-100 dark:bg-warm-800 overflow-hidden flex-shrink-0">
                  {thumbnail ? (
                    <Image
                      src={thumbnail}
                      alt={title}
                      width={48}
                      height={48}
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <Package className="h-4 w-4 text-warm-400" />
                    </div>
                  )}
                </div>

                {/* Title + meta */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{title}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Badge
                      variant="outline"
                      className={cn("text-[10px] px-1.5 py-0 h-4 font-medium", status.className)}
                    >
                      {status.label}
                    </Badge>
                    {(post.view_count ?? 0) > 0 && (
                      <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                        <Eye className="h-3 w-3" />
                        {post.view_count}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground">
                      {getRelativeDate(post.created_at)}
                    </span>
                  </div>
                </div>

                {/* Edit action */}
                <Button asChild variant="ghost" size="sm" className="h-8 w-8 p-0 flex-shrink-0">
                  <Link href={`/post/${post.id}/edit`} aria-label={`Edit ${title}`}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
