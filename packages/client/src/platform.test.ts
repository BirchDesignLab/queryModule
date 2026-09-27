import { describe, expect, it, vi } from "vitest";
import { noTokenStore } from "./platform.js";
import { createFakePlatform } from "./testing/fake-platform.js";

describe("ClientPlatform signals (spec 3, P0 PlatformSignal)", () => {
  it("notifies subscribers on change only and unsubscribes", () => {
    const platform = createFakePlatform();
    const seen = vi.fn();
    const off = platform.online.subscribe(seen);
    platform.setOnline(true);
    platform.setOnline(false);
    off();
    platform.setOnline(true);
    expect(seen.mock.calls).toEqual([[false]]);
    expect(platform.online.current()).toBe(true);
  });
  it("noTokenStore holds nothing", async () => {
    await noTokenStore.set("ignored");
    expect(await noTokenStore.get()).toBeNull();
    await noTokenStore.clear();
  });
});
