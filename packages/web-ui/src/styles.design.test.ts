import { readFileSync } from "node:fs";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { describe, expect, it } from "vitest";

// node:url's URL avoids jsdom's global URL failing Node fs's instanceof check on Windows (PR #83).
const css = readFileSync(fileURLToPath(new NodeURL("./styles.css", import.meta.url)), "utf8");

/** Declarations of every rule whose selector list contains `selector` as one of its entries. */
function decls(selector: string): string {
  return [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter(([, list]) =>
      (list ?? "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split(",")
        .map((sel) => sel.trim())
        .includes(selector),
    )
    .map(([, , body]) => body)
    .join("\n");
}

describe("design system D0.3 controls (docs/design/2026-09-29-visual-system.md)", () => {
  it("dispatch density: inputs and selects are the 36 px dense height", () => {
    expect(decls(".qm-field__input")).toMatch(/min-height:\s*var\(--qm-control-height-dense\)/);
    expect(decls(".qm-select")).toMatch(/min-height:\s*var\(--qm-control-height-dense\)/);
  });

  it("officer density: the mobile-unit layout uses the 56 px touch height and 48 px targets", () => {
    const input = decls(".qm-layout--mobile-unit .qm-field__input");
    expect(input).toMatch(/min-height:\s*var\(--qm-control-height-touch\)/);
    expect(decls(".qm-layout--mobile-unit .qm-select")).toMatch(
      /min-height:\s*var\(--qm-control-height-touch\)/,
    );
    expect(decls(".qm-layout--mobile-unit .qm-button")).toMatch(
      /min-height:\s*var\(--qm-control-height-touch\)/,
    );
    expect(decls(".qm-layout--mobile-unit .qm-seg > button")).toMatch(
      /min-height:\s*var\(--qm-target-min\)/,
    );
    expect(decls(".qm-layout--mobile-unit .qm-chip")).toMatch(
      /min-height:\s*var\(--qm-target-min\)/,
    );
  });

  it("officer text is never muted: tags, chip meta and badges use body colour at body size", () => {
    for (const cls of [".qm-tag", ".qm-chip__meta", ".qm-field__tag", ".qm-field__description"]) {
      const body = decls(`.qm-layout--mobile-unit ${cls}`);
      expect(body, cls).toMatch(/color:\s*var\(--qm-color-text-body\)/);
      expect(body, cls).toMatch(/font-size:\s*var\(--qm-type-body-size\)/);
    }
    // A badge keeps its own fg/bg pair (severity tokens, 4.5:1) in the layout: size only.
    const badge = decls(".qm-layout--mobile-unit .qm-badge");
    expect(badge).toMatch(/font-size:\s*var\(--qm-type-body-size\)/);
    expect(badge).not.toMatch(/color:/);
    expect(badge).not.toMatch(/background/);
  });

  it("E1: an invalid control has a 2 px required edge inside (border plus inset shadow)", () => {
    const body = decls('.qm-field__input[aria-invalid="true"]');
    expect(body).toMatch(/border-color:\s*var\(--qm-field-required\)/);
    expect(body).toMatch(
      /box-shadow:\s*inset 0 0 0 var\(--qm-border-width\) var\(--qm-field-required\)/,
    );
    for (const sel of ['.qm-select[aria-invalid="true"]']) {
      expect(decls(sel), sel).toMatch(/box-shadow:\s*inset/);
    }
  });

  it("E1: focus is a 2 px focus.ring outline offset outside the control, on :focus for inputs and selects too", () => {
    for (const sel of [
      ".qm-field__input:focus",
      ".qm-field__input:focus-visible",
      ".qm-select:focus",
      ".qm-select:focus-visible",
    ]) {
      const body = decls(sel);
      expect(body, sel).toMatch(
        /outline:\s*var\(--qm-focus-ring-width\) solid var\(--qm-focus-ring\)/,
      );
      expect(body, sel).toMatch(/outline-offset:\s*var\(--qm-focus-ring-offset\)/);
    }
  });

  it("E1: the ring uses only outline and the invalid cue only border and box-shadow, so both show", () => {
    const ring = [
      ".qm-field__input:focus",
      ".qm-select:focus",
      ".qm-checkbox input:focus-visible",
    ].map(decls);
    for (const body of ring) expect(body).not.toMatch(/border|box-shadow/);
    const invalid = [
      '.qm-field__input[aria-invalid="true"]',
      '.qm-select[aria-invalid="true"]',
      '.qm-checkbox input[aria-invalid="true"]',
    ].map(decls);
    for (const body of invalid) {
      expect(body).toMatch(/box-shadow|border-color/);
      expect(body).not.toMatch(/outline/);
    }
    // Nothing gates the invalid cue behind "not focused": it stays when the ring appears.
    expect(css).not.toMatch(/\[aria-invalid="true"\]:not\(:focus/);
  });

  it("E1: an invalid checkbox draws a 2 px required cue as a shadow hugging the box", () => {
    expect(decls('.qm-checkbox input[aria-invalid="true"]')).toMatch(
      /box-shadow:\s*0 0 0 calc\(var\(--qm-border-width\) \* 2\) var\(--qm-field-required\)/,
    );
  });

  it("chips draw one ring: on the label, not on the checkbox inside it", () => {
    expect(decls(".qm-chip:has(input:focus-visible)")).toMatch(
      /outline:\s*var\(--qm-focus-ring-width\)/,
    );
    expect(decls(".qm-chip input:focus-visible")).toMatch(/outline:\s*none/);
  });

  it("buttons: primary uses the accent fill and label pair; aria-disabled stays focusable and dashed", () => {
    const primary = decls(".qm-button");
    expect(primary).toMatch(/background:\s*var\(--qm-color-accent-fill\)/);
    expect(primary).toMatch(/color:\s*var\(--qm-color-accent-onFill\)/);
    const disabled = decls('.qm-button[aria-disabled="true"]');
    expect(disabled).toMatch(/border(-style)?:[^;]*dashed/);
    expect(disabled).toMatch(/color:\s*var\(--qm-color-text-muted\)/);
    expect(css).not.toMatch(/pointer-events:\s*none/);
    // A native disabled button (the admin builder's Publish and History today) reads the same.
    expect(decls(".qm-button:disabled")).toBe(disabled);
  });

  it("declares the secondary, ghost and danger button variants", () => {
    expect(decls(".qm-button--secondary")).toMatch(
      /background:\s*var\(--qm-color-surface-raised\)/,
    );
    expect(decls(".qm-button--ghost")).toMatch(/background:\s*transparent/);
    expect(decls(".qm-button--danger")).toMatch(/color:\s*var\(--qm-field-required\)/);
  });

  it("declares the segmented control: aria-pressed buttons in a sunken track", () => {
    expect(decls(".qm-seg")).toMatch(/background:\s*var\(--qm-color-surface-sunken\)/);
    expect(decls('.qm-seg > button[aria-pressed="true"]')).toMatch(
      /background:\s*var\(--qm-color-accent-subtle\)/,
    );
  });

  it("declares chips (checked fills with accent.subtle, meta in mono), badges, tags and kbd", () => {
    expect(decls(".qm-chip:has(input:checked)")).toMatch(
      /background:\s*var\(--qm-color-accent-subtle\)/,
    );
    expect(decls(".qm-chip__meta")).toMatch(/font-family:\s*var\(--qm-type-family-data\)/);
    expect(decls(".qm-badge")).toMatch(/font-family:\s*var\(--qm-type-family-label\)/);
    expect(decls(".qm-badge")).toMatch(/text-transform:\s*uppercase/);
    for (const s of ["critical", "warning", "info"]) {
      const body = decls(`.qm-badge--${s}`);
      expect(body, s).toContain(`background: var(--qm-color-severity-${s}-bg);`);
      expect(body, s).toContain(`color: var(--qm-color-severity-${s}-fg);`);
    }
    expect(decls(".qm-badge--status")).toMatch(/border-color:\s*var\(--qm-color-border\)/);
    expect(decls(".qm-tag")).toMatch(/font-size:\s*var\(--qm-type-size-xs\)/);
    expect(decls(".qm-kbd")).toMatch(/font-family:\s*var\(--qm-type-family-data\)/);
  });

  it("read-back data is monospace: the terminal input and ids use the data family", () => {
    expect(decls("[data-terminal] .qm-field__input")).toMatch(
      /font-family:\s*var\(--qm-type-family-data\)/,
    );
  });

  it("motion uses the motion tokens only (they drop to 0 ms under reduced motion), and a Shown tag stays static", () => {
    for (const [, value] of css.matchAll(/transition:([^;]*);/g))
      expect(value, value).toMatch(/var\(--qm-motion-duration-/);
    expect(css).not.toMatch(/\d+ms/);
  });

  it("programmatic focus targets that are not controls draw no ring (tabindex -1 headings, sections, main)", () => {
    // decls() splits on commas, and :where(...) holds some: match the rule text itself.
    expect(css).toMatch(
      /:where\(h1, h2, h3, h4, h5, h6, section, main\)\[tabindex="-1"\]:focus\s*\{[^}]*outline:\s*none/,
    );
  });

  it("the Default tag is a small condensed uppercase pill on accent.subtle, no border", () => {
    const body = decls(".qm-field__tag");
    expect(body).toMatch(/background:\s*var\(--qm-color-accent-subtle\)/);
    expect(body).toMatch(/color:\s*var\(--qm-color-text-body\)/);
    expect(body).toMatch(/font-family:\s*var\(--qm-type-family-label\)/);
    expect(body).toMatch(/text-transform:\s*uppercase/);
    expect(body).not.toMatch(/border:/);
  });
});

describe("parity pass, query surfaces (visual system: surfaces, type, controls and states)", () => {
  it("G1 the dispatcher panel is a surface.base card on the sunken page", () => {
    const panel = decls(".qm-query-panel:not(.qm-layout--mobile-unit) .qm-panes__panel");
    expect(panel).toMatch(/background:\s*var\(--qm-color-surface-base\)/);
    expect(panel).toMatch(
      /border:\s*var\(--qm-border-width\) solid var\(--qm-color-border-subtle\)/,
    );
    expect(panel).toMatch(/border-radius:\s*var\(--qm-radius-panel\)/);
  });

  it("G3 headings on the query panel use a shipped weight (600): no Bold face ships", () => {
    expect(decls(".qm-query-panel h1")).toMatch(/font-weight:\s*600/);
  });

  it("G4 sections inside the dispatcher card lose their own box; later ones get a top rule", () => {
    const section = decls(".qm-query-panel .qm-query-form__section");
    expect(section).toMatch(/border:\s*0/);
    expect(section).toMatch(/padding-inline:\s*0/);
    expect(decls(".qm-query-panel .qm-query-form__section--disclosure")).toMatch(
      /border-block-start:\s*var\(--qm-border-width\) solid var\(--qm-color-border-subtle\)/,
    );
  });

  it("G5 the Shown tag is accent-outlined and static; the flash runs once and never under reduced motion", () => {
    const tag = decls(".qm-tag--shown");
    expect(tag).toMatch(/border-color:\s*var\(--qm-color-accent\)/);
    expect(tag).toMatch(/color:\s*var\(--qm-color-accent\)/);
    expect(tag).not.toMatch(/animation/);
    const cell = decls(".qm-form-cell--revealed");
    expect(cell).toMatch(/animation:\s*qm-reveal\b[^;]*\b1\b|animation:\s*qm-reveal[^;]*forwards/);
    expect(css).toMatch(
      /@keyframes qm-reveal\s*\{\s*from\s*\{\s*background:\s*var\(--qm-color-accent-subtle\)/,
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.qm-form-cell--revealed\s*\{\s*animation:\s*none/,
    );
  });

  it("G7 quick-access hover lifts only where hover exists (no sticky hover on touch)", () => {
    expect(decls(".qm-quick-access__button:hover")).toBe("");
    expect(
      decls('.qm-layout--mobile-unit .qm-quick-access__button:hover:not([aria-pressed="true"])'),
    ).toBe("");
    expect(css).toMatch(/@media \(hover: hover\)\s*\{\s*\.qm-quick-access__button:hover\s*\{/);
    expect(css).toMatch(
      /@media \(hover: hover\)\s*\{\s*\.qm-layout--mobile-unit \.qm-quick-access__button:hover:not\(\[aria-pressed="true"\]\)\s*\{/,
    );
  });
});
