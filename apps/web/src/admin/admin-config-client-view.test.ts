import * as core from "@querymodule/core/config";
import { describe, expect, it, vi } from "vitest";
import { RAW_SITE } from "../test/msw-server.js";
import { editorOf } from "./admin-config.js";

vi.mock("@querymodule/core/config", async (importOriginal) => {
  const real = await importOriginal<typeof import("@querymodule/core/config")>();
  return { ...real, toClientSiteConfig: vi.fn(real.toClientSiteConfig) };
});

// Round 1, S1: the client view of a draft that validates is the core client-config function's
// output, not a hand copy of it that could drift from it.
describe("editorOf derives the client view with core toClientSiteConfig", () => {
  it("calls it for a siteConfig that parses, and the view has no configHash", () => {
    const { doc } = editorOf({ siteConfig: RAW_SITE, locales: {} });
    expect(core.toClientSiteConfig).toHaveBeenCalledTimes(1);
    expect(doc).not.toHaveProperty("configHash");
  });

  it("does not call it for a siteConfig that does not parse", () => {
    vi.mocked(core.toClientSiteConfig).mockClear();
    editorOf({ siteConfig: { ...RAW_SITE, terminal: { delimiter: 5 } }, locales: {} });
    expect(core.toClientSiteConfig).not.toHaveBeenCalled();
  });
});
