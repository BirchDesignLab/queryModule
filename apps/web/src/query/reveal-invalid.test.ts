import { afterEach, describe, expect, it, vi } from "vitest";
import { revealLastInvalid } from "./reveal-invalid.js";

function rect(top: number, bottom: number): DOMRect {
  return {
    top,
    bottom,
    left: 0,
    right: 10,
    width: 10,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}

/** Two invalid fields, each in a [data-field-key] wrapper; `boxes` gives each wrapper's rect. */
function setup(boxes: { first: DOMRect; last: DOMRect }, clearance = "100px") {
  document.body.innerHTML = `
    <form>
      <div data-field-key="a"><input aria-invalid="true" /></div>
      <div data-field-key="b"><input aria-invalid="true" /><p>Caliber is required.</p></div>
    </form>`;
  const [a, b] = Array.from(document.querySelectorAll<HTMLElement>("[data-field-key]"));
  if (a === undefined || b === undefined) throw new Error("setup");
  vi.spyOn(a, "getBoundingClientRect").mockReturnValue(boxes.first);
  vi.spyOn(b, "getBoundingClientRect").mockReturnValue(boxes.last);
  document.documentElement.style.scrollPaddingBlockEnd = clearance;
  const scrollBy = vi.fn();
  window.scrollBy = scrollBy as unknown as typeof window.scrollBy;
  return { scrollBy, root: document.querySelector("form") as HTMLElement };
}

afterEach(() => {
  document.body.innerHTML = "";
  document.documentElement.style.removeProperty("scroll-padding-block-end");
  vi.restoreAllMocks();
});

describe("G13 a blocked submit keeps the last invalid field clear of the sticky action bar", () => {
  it("scrolls by what the last field's box overlaps the bar", () => {
    // viewport 768 tall, bar 100: the clear area ends at 668; the last box ends at 720.
    const { scrollBy, root } = setup({ first: rect(300, 380), last: rect(640, 720) });
    revealLastInvalid(root);
    expect(scrollBy).toHaveBeenCalledWith({ top: 52 });
  });

  it("never scrolls the first invalid field out of the top of the viewport", () => {
    const { scrollBy, root } = setup({ first: rect(20, 60), last: rect(640, 900) });
    revealLastInvalid(root);
    expect(scrollBy).toHaveBeenCalledWith({ top: 20 });
  });

  it("does nothing when the last field is already clear, or there is only one invalid field", () => {
    const clear = setup({ first: rect(300, 380), last: rect(400, 500) });
    revealLastInvalid(clear.root);
    expect(clear.scrollBy).not.toHaveBeenCalled();
    document.body.innerHTML =
      '<form><div data-field-key="a"><input aria-invalid="true" /></div></form>';
    revealLastInvalid(document.querySelector("form") as HTMLElement);
    expect(clear.scrollBy).not.toHaveBeenCalled();
  });
});
