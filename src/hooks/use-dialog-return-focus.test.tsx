import { useState } from "react";
import { fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useDialogReturnFocus } from "./use-dialog-return-focus";

function StateOpenedDialog() {
  const [open, setOpen] = useState(false);
  const { rememberOpener, onCloseAutoFocus } = useDialogReturnFocus();
  return (
    <>
      <button type="button">Before</button>
      <button
        type="button"
        onClick={(event) => {
          rememberOpener(event.currentTarget);
          setOpen(true);
        }}
      >
        Report
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
          <DialogTitle>Report this post</DialogTitle>
        </DialogContent>
      </Dialog>
    </>
  );
}

describe("useDialogReturnFocus", () => {
  it("puts focus back on the control that opened a state-driven dialog", async () => {
    render(<StateOpenedDialog />);
    const opener = screen.getByRole("button", { name: "Report" });
    opener.focus();
    fireEvent.click(opener);
    await screen.findByRole("dialog");

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(opener).toHaveFocus();
  });

  it("leaves the default behaviour when the opener has left the page", () => {
    const { result } = renderHook(() => useDialogReturnFocus());
    const detached = document.createElement("button");
    result.current.rememberOpener(detached);

    const event = new Event("focusout", { cancelable: true });
    result.current.onCloseAutoFocus(event);

    expect(event.defaultPrevented).toBe(false);
  });
});
