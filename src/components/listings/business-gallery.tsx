"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { Camera } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MediaLightbox, type MediaItem } from "@/components/ui/media-lightbox";

interface BusinessGalleryProps {
  photos: string[];
  businessName: string;
}

export function BusinessGallery({ photos, businessName }: BusinessGalleryProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxStart, setLightboxStart] = useState(0);

  const lightboxItems: MediaItem[] = useMemo(
    () => photos.map((url) => ({ kind: "photo" as const, url })),
    [photos]
  );

  function openLightbox(index: number) {
    setLightboxStart(index);
    setLightboxOpen(true);
  }

  function closeLightbox() {
    setLightboxOpen(false);
  }

  if (photos.length === 0) return null;

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Camera className="w-4 h-4 text-muted-foreground" />
            Photos
            <span className="text-xs font-normal text-muted-foreground">({photos.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Desktop: Grid layout */}
          <div className="hidden md:grid grid-cols-2 lg:grid-cols-3 gap-3">
            {photos.map((photo, index) => (
              <button
                type="button"
                key={index}
                onClick={() => openLightbox(index)}
                className="relative aspect-[4/3] rounded-xl overflow-hidden bg-muted group cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                aria-label={`View photo ${index + 1} of ${photos.length}`}
              >
                <Image
                  src={photo}
                  alt={`${businessName} photo ${index + 1}`}
                  fill
                  className="bg-muted object-contain transition-transform duration-300 group-hover:scale-105"
                  sizes="(max-width: 1024px) 50vw, 33vw"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
              </button>
            ))}
          </div>

          {/* Mobile: Horizontal scroll carousel */}
          <div className="md:hidden flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 -mx-1 px-1 scrollbar-hide">
            {photos.map((photo, index) => (
              <button
                type="button"
                key={index}
                onClick={() => openLightbox(index)}
                className="relative flex-none w-[70vw] max-w-[280px] aspect-[4/3] rounded-xl overflow-hidden bg-muted snap-center cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`View photo ${index + 1} of ${photos.length}`}
              >
                <Image
                  src={photo}
                  alt={`${businessName} photo ${index + 1}`}
                  fill
                  className="bg-muted object-contain"
                  sizes="70vw"
                />
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Media Lightbox */}
      <MediaLightbox
        items={lightboxItems}
        startIndex={lightboxStart}
        isOpen={lightboxOpen}
        onClose={closeLightbox}
      />
    </>
  );
}
