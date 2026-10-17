import { createTranslator } from "@querymodule/client";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../app/i18n-context.js";
import { ServicesProvider } from "../app/services-context.js";
import { EN_BUNDLE } from "../test/en-bundle.js";
import { testServices } from "../test/render-routes.js";
import { cardIndexOf, useCardName } from "./card-names.js";
import type { JsonObject } from "./draft.js";

// T10-Q2 (#642): useCardName's callback is stable while the sources and personas are, so the tree
// nodes built from it are not rebuilt on every render. Synthetic fixtures only.

const DOC: JsonObject = {
  sources: [{ id: "state", labelKey: "source.state" }],
  personas: [{ key: "dispatch", labelKey: "persona.dispatch" }],
  responseMappings: [{ id: "veh-1", queryType: "VEH" }],
};

function setup(initial: JsonObject) {
  const services = testServices();
  const translator = createTranslator("en", EN_BUNDLE);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ServicesProvider services={services}>
      <I18nProvider translator={translator}>{children}</I18nProvider>
    </ServicesProvider>
  );
  return renderHook(({ doc }: { doc: JsonObject }) => useCardName(doc), {
    wrapper,
    initialProps: { doc: initial },
  });
}

describe("useCardName (T10-Q2)", () => {
  it("keeps the same callback when the sources and personas are the same", () => {
    const view = setup(DOC);
    const first = view.result.current;
    // An edit elsewhere in the draft makes a new doc object but keeps the unchanged subtrees.
    view.rerender({ doc: { ...DOC, responseMappings: [] } });
    expect(view.result.current).toBe(first);
  });

  it("makes a new callback when the sources change", () => {
    const view = setup(DOC);
    const first = view.result.current;
    view.rerender({ doc: { ...DOC, sources: [{ id: "state", labelKey: "source.other" }] } });
    expect(view.result.current).not.toBe(first);
  });

  it("capitalizes the rule only when it stands alone", () => {
    const view = setup(DOC);
    const rule = { op: "notEmpty", field: "plate" };
    expect(view.result.current({ when: rule })).toBe("Only when a rule matches");
    expect(view.result.current({ sourceId: "state", when: rule })).toBe(
      "state, when a rule matches",
    );
  });

  it("still names a card by its narrowing", () => {
    const view = setup(DOC);
    expect(view.result.current({})).toBe("All results");
    expect(view.result.current({ sourceId: "state", persona: "dispatch" })).toBe("state, Dispatch");
  });
});

describe("cardIndexOf", () => {
  it("reads the card index from a card or row pointer, else null", () => {
    expect(cardIndexOf("/responseMappings/2")).toBe(2);
    expect(cardIndexOf("/responseMappings/2/elements/0/path")).toBe(2);
    expect(cardIndexOf("/keywords/1")).toBeNull();
    expect(cardIndexOf(null)).toBeNull();
  });
});
