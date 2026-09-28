import { createTranslator } from "@querymodule/client";
import { describe, expect, it } from "vitest";
import { EN_BUNDLE } from "../test/en-bundle.js";
import { FALLBACK_MESSAGES } from "./fallback-messages.js";

describe("NFR-001 boot fallback strings stay in step with en.json", () => {
  it.each(Object.keys(FALLBACK_MESSAGES))("%s matches the shipped bundle", (key) => {
    expect(createTranslator("en", FALLBACK_MESSAGES).t(key)).toBe(
      createTranslator("en", EN_BUNDLE).t(key),
    );
  });
});
