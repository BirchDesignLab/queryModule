import { render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useActionBarClearance } from "./use-action-bar-clearance.js";

let callbacks: Array<() => void> = [];
let disconnected = 0;

beforeEach(() => {
  callbacks = [];
  disconnected = 0;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(cb: () => void) {
        callbacks.push(cb);
      }
      observe() {}
      disconnect() {
        disconnected++;
      }
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.style.removeProperty("scroll-padding-block-end");
});

function Harness({
  enabled,
  mode,
  height,
  position = "sticky",
}: {
  enabled: boolean;
  mode: string;
  height: number;
  position?: "sticky" | "static";
}) {
  const ref = useRef<HTMLDivElement>(null);
  useActionBarClearance(ref, enabled, mode);
  return (
    <div ref={ref}>
      <div
        className="qm-action-bar"
        style={{ position }}
        ref={(el) => {
          if (el !== null) el.getBoundingClientRect = () => ({ height }) as DOMRect;
        }}
      />
    </div>
  );
}

const published = () => document.documentElement.style.getPropertyValue("scroll-padding-block-end");
const clear = (px: number) => `calc(${px}px + var(--qm-space-2))`;

describe("hardening: the action bar's height is published for scroll-padding (WCAG 2.4.11)", () => {
  it("publishes the bar's height and follows a resize", () => {
    render(<Harness enabled mode="form" height={61} />);
    expect(published()).toBe(clear(61));
    const el = document.querySelector<HTMLElement>(".qm-action-bar");
    if (el === null) throw new Error("no bar");
    el.getBoundingClientRect = () => ({ height: 89 }) as DOMRect;
    for (const cb of callbacks) cb();
    expect(published()).toBe(clear(89));
  });

  it("removes the property and stops observing on unmount", () => {
    const { unmount } = render(<Harness enabled mode="form" height={61} />);
    unmount();
    expect(published()).toBe("");
    expect(disconnected).toBe(1);
  });

  it("re-binds when the mode changes (the terminal mounts its own bar)", () => {
    const { rerender } = render(<Harness enabled mode="form" height={61} />);
    rerender(<Harness enabled mode="terminal" height={61} />);
    expect(disconnected).toBe(1);
    expect(callbacks).toHaveLength(2);
    expect(published()).toBe(clear(61));
  });

  it("keeps nothing clear while the bar is not sticky (a short viewport), and re-checks on resize", () => {
    render(<Harness enabled mode="form" height={61} position="static" />);
    expect(published()).toBe("");
    const bar = document.querySelector<HTMLElement>(".qm-action-bar");
    if (bar === null) throw new Error("no bar");
    bar.style.position = "sticky";
    window.dispatchEvent(new Event("resize"));
    expect(published()).toBe(clear(61));
  });

  it("does nothing for the preview (disabled)", () => {
    render(<Harness enabled={false} mode="form" height={61} />);
    expect(published()).toBe("");
    expect(callbacks).toHaveLength(0);
  });

  it("does nothing where ResizeObserver does not exist", () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("ResizeObserver", undefined);
    render(<Harness enabled mode="form" height={61} />);
    expect(published()).toBe("");
  });
});
