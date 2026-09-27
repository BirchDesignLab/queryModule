import { describe, expect, it } from "vitest";
import { createTranslator, isLocaleBundle } from "./translator.js";

const bundle = {
  "validation.required": "{label} is required.",
  "announce.fieldsNeedAttention.one": "{count} field needs attention",
  "announce.fieldsNeedAttention.other": "{count} fields need attention",
  status: { connected: "Connected. Heartbeat round trip {rttMs} ms." },
};

describe("NFR-001 message keys resolve through the locale bundle (spec 5.8, 6.7)", () => {
  const t = createTranslator("en", bundle);
  it("interpolates params", () => {
    expect(t.t("validation.required", { field: "email", label: "Email" })).toBe(
      "Email is required.",
    );
  });
  it("chooses the plural category from count", () => {
    expect(t.t("announce.fieldsNeedAttention", { count: 1 })).toBe("1 field needs attention");
    expect(t.t("announce.fieldsNeedAttention", { count: 2 })).toBe("2 fields need attention");
  });
  it("reads nested bundles and formats numbers with Intl", () => {
    expect(t.t("status.connected", { rttMs: 1234 })).toBe(
      "Connected. Heartbeat round trip 1,234 ms.",
    );
  });
  it("falls back to the key and leaves unknown params in place", () => {
    expect(t.t("missing.key")).toBe("missing.key");
    expect(t.t("validation.required")).toBe("{label} is required.");
    expect(t.has("validation.required")).toBe(true);
    expect(t.has("missing.key")).toBe(false);
  });
  it("validates bundle shape", () => {
    expect(isLocaleBundle(bundle)).toBe(true);
    expect(isLocaleBundle({ a: 1 })).toBe(false);
    expect(isLocaleBundle(null)).toBe(false);
  });
});
