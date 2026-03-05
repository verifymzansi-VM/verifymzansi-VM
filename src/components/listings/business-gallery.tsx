"use client";

import { useState } from "react";
import Image from "next/image";
import { Camera, X, ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

interface BusinessGalleryProps {
  photos: string[];
  businessName: string;
}

export function BusinessGallery({ photos, businessName }: BusinessGalleryProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  function openLightbox(index: number) {
    setLightboxIndex(index);
  }

  function closeLightbox() {
    setLightboxIndex(null);
  }

  function goNext() {
    if (lightboxIndex !== null) {
      setLightboxIndex((lightboxIndex + 1) % photos.length);
    }
  }

  function goPrev() {
    if (lightboxIndex !== null) {
      setLightboxIndex((lightboxIndex - 1 + photos.length) % photos.length);
    }
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
                  className="object-cover transition-transform duration-300 group-hover:scale-105"
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
                  className="object-cover"
                  sizes="70vw"
                />
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Lightbox Dialog */}
      <Dialog open={lightboxIndex !== null} onOpenChange={(open) => !open && closeLightbox()}>
        <DialogContent className="max-w-4xl w-full p-0 bg-black/95 border-none overflow-hidden">
          <DialogTitle className="sr-only">
            {businessName} photo {lightboxIndex !== null ? lightboxIndex + 1 : ""} of{" "}
            {photos.length}
          </DialogTitle>

          {lightboxIndex !== null && (
            <div className="relative flex items-center justify-center min-h-[40vh] max-h-[85vh]">
              {/* Close button */}
              <button
                type="button"
                onClick={closeLightbox}
                className="absolute top-3 right-3 z-20 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 transition-colors"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>

              {/* Navigation arrows */}
              {photos.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={goPrev}
                    className="absolute left-3 z-20 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 transition-colors"
                    aria-label="Previous photo"
                  >
                    <ChevronLeft className="h-6 w-6" />
                  </button>
                  <button
                    type="button"
                    onClick={goNext}
                    className="absolute right-3 z-20 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 transition-colors"
                    aria-label="Next photo"
                  >
                    <ChevronRight className="h-6 w-6" />
                  </button>
                </>
              )}

              {/* Image */}
              <div className="relative w-full h-[70vh]">
                <Image
                  src={photos[lightboxIndex]}
                  alt={`${businessName} photo ${lightboxIndex + 1}`}
                  fill
                  className="object-contain"
                  sizes="100vw"
                  priority
                />
              </div>

              {/* Photo counter */}
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/80 text-sm bg-black/50 px-3 py-1 rounded-full backdrop-blur-sm">
                {lightboxIndex + 1} / {photos.length}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
