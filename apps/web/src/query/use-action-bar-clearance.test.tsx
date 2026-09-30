import { act, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useActionBarClearance } from "./use-action-bar-clearance.js";

interface Entry {
  target: Element;
  borderBoxSize: Array<{ blockSize: number }>;
}
let observers: Array<{ callback: (entries: Entry[]) => void; disconnected: boolean }> = [];
let short = false;
let mediaListeners: Array<() => void> = [];
let layoutReads = 0;

beforeEach(() => {
  observers = [];
  short = false;
  mediaListeners = [];
  layoutReads = 0;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      private readonly record: { callback: (entries: Entry[]) => void; disconnected: boolean };
      constructor(callback: (entries: Entry[]) => void) {
        this.record = { callback, disconnected: false };
        observers.push(this.record);
      }
      observe() {}
      disconnect() {
        this.record.disconnected = true;
      }
    },
  );
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      return short && query === "(max-height: 20rem)";
    },
    addEventListener: (_type: string, listener: () => void) => mediaListeners.push(listener),
    removeEventListener: (_type: string, listener: () => void) => {
      mediaListeners = mediaListeners.filter((l) => l !== listener);
    },
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.style.removeProperty("scroll-padding-block-end");
});

function Harness({ enabled, mode }: { enabled: boolean; mode: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useActionBarClearance(ref, enabled, mode);
  return (
    <div ref={ref}>
      <div
        className="qm-action-bar"
        ref={(el) => {
          if (el === null) return;
          // A layout read here would force a synchronous layout in the middle of a commit.
          el.getBoundingClientRect = () => {
            layoutReads += 1;
            return { height: 0 } as DOMRect;
          };
        }}
      />
    </div>
  );
}

const published = () => document.documentElement.style.getPropertyValue("scroll-padding-block-end");
const clear = (px: number) => `calc(${px}px + var(--qm-space-2))`;
const resize = (height: number, at = observers.length - 1) =>
  act(() => {
    const observer = observers[at];
    const target = document.querySelector(".qm-action-bar") as Element;
    observer?.callback([{ target, borderBoxSize: [{ blockSize: height }] }]);
  });

describe("hardening: the action bar's height is published for scroll-padding (WCAG 2.4.11)", () => {
  it("publishes the height the observer reports and follows a resize, with no layout read", () => {
    render(<Harness enabled mode="form" />);
    // Nothing is forced at mount: the observer's first callback (after layout) publishes.
    expect(published()).toBe("");
    resize(61);
    expect(published()).toBe(clear(61));
    resize(89);
    expect(published()).toBe(clear(89));
    expect(layoutReads).toBe(0);
  });

  it("removes the property and stops observing on unmount", () => {
    const { unmount } = render(<Harness enabled mode="form" />);
    resize(61);
    unmount();
    expect(published()).toBe("");
    expect(observers.every((o) => o.disconnected)).toBe(true);
    expect(mediaListeners).toHaveLength(0);
  });

  it("re-binds when the mode changes without dropping the value (no flicker on a type or mode switch)", () => {
    const { rerender } = render(<Harness enabled mode="form" />);
    resize(61);
    rerender(<Harness enabled mode="terminal" />);
    expect(observers).toHaveLength(2);
    expect(observers[0]?.disconnected).toBe(true);
    // Still set while the new bar has not reported yet: a removal and a re-set would restyle twice.
    expect(published()).toBe(clear(61));
    resize(61);
    expect(published()).toBe(clear(61));
  });

  it("keeps nothing clear on a short viewport, where the bar does not stick, and follows the query", () => {
    render(<Harness enabled mode="form" />);
    resize(61);
    short = true;
    act(() => {
      for (const listener of mediaListeners) listener();
    });
    expect(published()).toBe("");
    short = false;
    act(() => {
      for (const listener of mediaListeners) listener();
    });
    expect(published()).toBe(clear(61));
  });

  it("a short viewport at mount publishes nothing", () => {
    short = true;
    render(<Harness enabled mode="form" />);
    resize(61);
    expect(published()).toBe("");
  });

  it("does nothing for the preview (disabled)", () => {
    render(<Harness enabled={false} mode="form" />);
    expect(published()).toBe("");
    expect(observers).toHaveLength(0);
  });

  it("does nothing where ResizeObserver does not exist", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    render(<Harness enabled mode="form" />);
    expect(published()).toBe("");
  });

  it("still publishes where matchMedia does not exist", () => {
    vi.stubGlobal("matchMedia", undefined);
    render(<Harness enabled mode="form" />);
    resize(61);
    expect(published()).toBe(clear(61));
  });
});
