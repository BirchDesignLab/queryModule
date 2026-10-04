import { fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import { useDialog } from "./use-dialog.js";

// #507 item 19 (R1-N1): StrictMode runs the unmount cleanup once on mount. It must not leave the
// hook ignoring a native close until the next render.

function Probe({ onDismiss }: { onDismiss(): void }) {
  const { dialogRef, dialogProps } = useDialog({
    open: true,
    onDismiss,
    stops: "button",
    initialFocus: (d) => d.querySelector("button"),
  });
  return (
    <dialog ref={dialogRef} aria-label="probe" {...dialogProps}>
      <button type="button">ok</button>
    </dialog>
  );
}

describe("useDialog under StrictMode", () => {
  it("still asks onDismiss when the browser closes the dialog on its own, before any re-render", () => {
    const onDismiss = vi.fn();
    render(
      <StrictMode>
        <Probe onDismiss={onDismiss} />
      </StrictMode>,
    );
    const dialog = screen.getByRole("dialog", { name: "probe", hidden: true });
    fireEvent(dialog, new Event("close"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
