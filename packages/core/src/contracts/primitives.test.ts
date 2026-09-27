import { describe, expect, it } from "vitest";
import {
  BOUNDED_ID_MAX_LENGTH,
  BoundedIdSchema,
  DurationMsSchema,
  EpochMsSchema,
  FIELD_KEY_PATTERN,
  FieldKeySchema,
  HOST_SUBJECT_MAX_LENGTH,
  HostSubjectSchema,
  MAX_ALSO_RUN,
  MESSAGE_KEY_MAX_LENGTH,
  MESSAGE_KEY_PATTERN,
  MessageKeySchema,
  NestedPartIdSchema,
  ParentPartIdSchema,
  PartIdSchema,
  Sha256HexSchema,
  TYPE_PICKLIST_CODE_PATTERN,
  TypePicklistCodeSchema,
  TypeValuesSchema,
  Uuid7Schema,
} from "./primitives";

const ok = (s: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) =>
  s.safeParse(v).success;

describe("ADR-0005 shared contract primitives", () => {
  it("Uuid7: canonical lowercase UUIDv7 only (spec 5.5 line 854)", () => {
    expect(ok(Uuid7Schema, "0199a0b0-0000-7000-8000-000000000001")).toBe(true);
    expect(ok(Uuid7Schema, "0199a0b0-0000-7abc-bfff-00000000000f")).toBe(true);
    for (const bad of [
      "0199A0B0-0000-7000-8000-000000000001", // uppercase
      "0199a0b0-0000-4000-8000-000000000001", // v4
      "0199a0b0-0000-7000-c000-000000000001", // wrong variant
      "0199a0b000007000800000000000000001", // no hyphens
      "c1",
      "",
    ]) {
      expect(ok(Uuid7Schema, bad)).toBe(false);
    }
  });

  it("Sha256Hex: 64 lowercase hex characters (spec 5.8 line 988)", () => {
    expect(ok(Sha256HexSchema, "a".repeat(64))).toBe(true);
    expect(ok(Sha256HexSchema, "0123456789abcdef".repeat(4))).toBe(true);
    expect(ok(Sha256HexSchema, "a".repeat(63))).toBe(false);
    expect(ok(Sha256HexSchema, "a".repeat(65))).toBe(false);
    expect(ok(Sha256HexSchema, "A".repeat(64))).toBe(false);
    expect(ok(Sha256HexSchema, "abc123")).toBe(false);
  });

  it("BoundedId: letters, digits, underscore and hyphen, 1 to 64", () => {
    expect(BOUNDED_ID_MAX_LENGTH).toBe(64);
    for (const good of [
      "u1",
      "system",
      "stateSource",
      "example-ok",
      "mock",
      "a_b",
      "x".repeat(64),
    ]) {
      expect(ok(BoundedIdSchema, good)).toBe(true);
    }
    for (const bad of ["", "x".repeat(65), "a b", "a.b", "a/b", "TESTERSON, T"]) {
      expect(ok(BoundedIdSchema, bad)).toBe(false);
    }
  });

  it("HostSubject: printable text, 1 to 255 characters", () => {
    expect(HOST_SUBJECT_MAX_LENGTH).toBe(255);
    for (const good of ["host|0001", "urn:example:user:0001", "s".repeat(255)]) {
      expect(ok(HostSubjectSchema, good)).toBe(true);
    }
    for (const bad of ["", "s".repeat(256), "a\nb", "a\u0000b", "a\tb"]) {
      expect(ok(HostSubjectSchema, bad)).toBe(false);
    }
  });

  it("FieldKey: letter then up to 63 letters or digits", () => {
    expect(FIELD_KEY_PATTERN.source).toBe("^[A-Za-z][A-Za-z0-9]{0,63}$");
    for (const good of ["plate", "plateType", "dob", "tagSticker", `a${"b".repeat(63)}`]) {
      expect(ok(FieldKeySchema, good)).toBe(true);
    }
    for (const bad of [
      "",
      "1plate",
      "plate_type",
      "plate-type",
      "plate.type",
      `a${"b".repeat(64)}`,
    ]) {
      expect(ok(FieldKeySchema, bad)).toBe(false);
    }
  });

  it("TypePicklistCode: 1 to 32 letters or digits", () => {
    expect(TYPE_PICKLIST_CODE_PATTERN.source).toBe("^[A-Za-z0-9]{1,32}$");
    for (const good of ["TX", "PC", "BOAT", "FIREARM", "WNT", "1", "c".repeat(32)]) {
      expect(ok(TypePicklistCodeSchema, good)).toBe(true);
    }
    for (const bad of ["", "BLK/WHI", "A B", "A-B", "c".repeat(33)]) {
      expect(ok(TypePicklistCodeSchema, bad)).toBe(false);
    }
  });

  it("EpochMs is a non-negative integer; DurationMs is a non-negative finite number", () => {
    expect(ok(EpochMsSchema, 1790000000000)).toBe(true);
    expect(ok(EpochMsSchema, 0)).toBe(true);
    expect(ok(EpochMsSchema, -1)).toBe(false);
    expect(ok(EpochMsSchema, 1.5)).toBe(false);
    expect(ok(DurationMsSchema, 12.5)).toBe(true);
    expect(ok(DurationMsSchema, 0)).toBe(true);
    expect(ok(DurationMsSchema, -0.1)).toBe(false);
    expect(ok(DurationMsSchema, Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("part ids follow spec 5.2 line 747: primary 0, nested 1 to MAX_ALSO_RUN, parent 0", () => {
    expect(MAX_ALSO_RUN).toBe(4);
    for (const id of [0, 1, 4]) expect(ok(PartIdSchema, id)).toBe(true);
    for (const id of [-1, 5, 999, 1.5]) expect(ok(PartIdSchema, id)).toBe(false);
    for (const id of [1, 4]) expect(ok(NestedPartIdSchema, id)).toBe(true);
    for (const id of [0, 5]) expect(ok(NestedPartIdSchema, id)).toBe(false);
    expect(ok(ParentPartIdSchema, 0)).toBe(true);
    for (const id of [1, 3, null]) expect(ok(ParentPartIdSchema, id)).toBe(false);
  });

  it("TypeValues maps field keys to type picklist codes (audit typeValues, mock types)", () => {
    expect(ok(TypeValuesSchema, { plateType: "PC", state: "ZZ" })).toBe(true);
    expect(ok(TypeValuesSchema, {})).toBe(true);
    expect(ok(TypeValuesSchema, { "plate-type": "PC" })).toBe(false);
    expect(ok(TypeValuesSchema, { plateType: "P C" })).toBe(false);
  });

  it("MessageKey: lowerCamel segments separated by dots, at most 128 characters (#61)", () => {
    expect(MESSAGE_KEY_MAX_LENGTH).toBe(128);
    expect(MESSAGE_KEY_PATTERN.source).toBe(String.raw`^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)*$`);
    const longest = `a${".b".repeat(63)}a`;
    expect(longest).toHaveLength(128);
    for (const good of [
      "app.title",
      "config.unknownToken",
      "field.plate",
      "a",
      "picklist.state.TX",
      longest,
    ]) {
      expect(ok(MessageKeySchema, good)).toBe(true);
    }
    for (const bad of [
      "",
      "App.title",
      "app..title",
      "app.",
      ".app",
      "app title",
      "app-title",
      "app_title",
      `${longest}b`,
      "plate.ZZ-0001",
    ]) {
      expect(ok(MessageKeySchema, bad)).toBe(false);
    }
  });

  it("MessageKey pattern runs in linear time on adversarial input (CodeQL js/redos)", {
    timeout: 2000,
  }, () => {
    for (const evil of [
      `a${".a".repeat(5000)}!`,
      `${"a".repeat(10000)}!`,
      `a${".".repeat(9999)}`,
    ]) {
      const start = performance.now();
      expect(MESSAGE_KEY_PATTERN.test(evil)).toBe(false);
      expect(performance.now() - start).toBeLessThan(100);
    }
  });
});
