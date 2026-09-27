import { describe, expect, it } from "vitest";
import { createFakePlatform } from "./fake-platform";

describe("NFR-003 ClientPlatform fake (spec 3)", () => {
  it("cookie transport has no token store", () => {
    expect(createFakePlatform().tokenStore).toBeNull();
    expect(createFakePlatform().authTransport).toBe("cookie");
  });

  it("bearer transport stores, reads and clears a token in memory", async () => {
    const p = createFakePlatform({ authTransport: "bearer" });
    await p.tokenStore?.set("t1");
    expect(await p.tokenStore?.get()).toBe("t1");
    await p.tokenStore?.clear();
    expect(await p.tokenStore?.get()).toBeNull();
  });

  it("online signal notifies on change only, until unsubscribed", () => {
    const p = createFakePlatform();
    const seen: boolean[] = [];
    const off = p.online.subscribe((v) => seen.push(v));
    p.setOnline(true);
    p.setOnline(false);
    off();
    p.setOnline(true);
    expect(seen).toEqual([false]);
    expect(p.online.current()).toBe(true);
  });

  it("defaults to online and visible", () => {
    const p = createFakePlatform();
    expect(p.online.current()).toBe(true);
    expect(p.visible.current()).toBe(true);
  });

  it("visibility signal follows setVisible from a hidden start", () => {
    const p = createFakePlatform({ visible: false });
    expect(p.visible.current()).toBe(false);
    p.setVisible(true);
    expect(p.visible.current()).toBe(true);
  });
});
