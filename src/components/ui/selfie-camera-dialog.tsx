"use client";

import { type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ShieldCheck, X } from "lucide-react";

/** A viewport-sized camera surface, including on browsers without Fullscreen API support. */
export function SelfieCameraDialog({
  children,
  onClose,
  onRestoreFocus,
}: {
  children: ReactNode;
  onClose: () => void;
  onRestoreFocus: () => void;
}) {
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-slate-950" />
        <Dialog.Content
          className="fixed inset-0 z-[201] flex h-[100dvh] w-full flex-col overflow-y-auto bg-slate-950 text-white outline-none [@media(max-height:500px)]:grid [@media(max-height:500px)]:grid-cols-2 [@media(max-height:500px)]:grid-rows-[auto_minmax(0,1fr)]"
          onInteractOutside={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onRestoreFocus();
          }}
        >
          <header className="col-span-2 flex shrink-0 items-center gap-3 px-5 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <ShieldCheck className="h-5 w-5 text-emerald-300" aria-hidden />
            <div className="flex-1">
              <Dialog.Title className="text-base font-semibold">Selfie verification</Dialog.Title>
              <Dialog.Description className="text-xs text-slate-300">
                Follow the guide. Your photo is taken automatically.
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Close camera"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            >
              <X className="h-5 w-5" />
            </Dialog.Close>
          </header>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
