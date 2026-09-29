import type { CommandDef } from "../config/schema";
import { FIELD_KEY_PATTERN } from "../contracts/primitives";
import type { ValidationError } from "../contracts/validation-error";
import { findQueryType } from "../rules/compile";
import type { TerminalConfig, TokenizeResult } from "./types";

type Position = CommandDef["positions"][number];
type RestPosition = Extract<Position, { rest: true }>;

const fieldOf = (p: Position): string => (typeof p === "string" ? p : p.field);
const isRest = (p: Position | undefined): p is RestPosition =>
  typeof p === "object" && p.rest === true;

/** Spec 4.4. Pure; returns every value it could read and every error it found. */
export function tokenize(config: TerminalConfig, input: string): TokenizeResult {
  const out: TokenizeResult = {
    userValues: {},
    positionedKeys: [],
    presetKeys: [],
    namedKeys: [],
    errors: [],
  };
  const text = input.trim();
  if (text === "") return { ...out, errors: [{ key: "terminal.emptyInput" }] };
  const d = config.terminal.delimiter;
  const cut = text.indexOf(d);
  const code = (cut === -1 ? text : text.slice(0, cut)).trim();
  const cmd = config.commands.find((c) => c.code.toLowerCase() === code.toLowerCase());
  if (cmd === undefined) {
    const error: ValidationError =
      cut === -1
        ? { key: "terminal.missingDelimiter", params: { length: text.length } }
        : { key: "terminal.unknownCommand", params: { code } };
    return { ...out, errors: [error] };
  }
  out.commandCode = cmd.code;
  out.queryType = cmd.queryType;
  const fields = findQueryType(config, cmd.queryType)?.fields ?? [];
  const byLower = new Map(fields.map((f) => [f.key.toLowerCase(), f]));
  for (const [k, v] of Object.entries(cmd.presets ?? {})) {
    out.userValues[k] = String(v);
    out.presetKeys.push(k);
  }
  if (cut === -1) return out;

  let remaining: string | null = text.slice(cut + d.length);
  let pos = 0; // next CommandDef position
  let tokenNo = 0; // 1-based value token number
  let seenNamed = false;
  let positional = 0; // positional tokens before the first named one, interior empties included
  let overflow = false; // a non-empty token landed past the last position
  const restAt = cmd.positions.findIndex(isRest);
  // Before a rest position, only the tokens up to it are split: the remainder there is one
  // value (delimiters included), so a delimiter-only rest value is not a trailing empty.
  const isTrailingEmpty = (token: string, rest: string | null) => {
    if (token.trim() !== "") return false;
    if (rest === null) return true;
    const parts = rest.split(d);
    const upTo = !seenNamed && restAt > pos ? restAt - pos - 1 : parts.length;
    return (
      parts.slice(0, upTo).every((x) => x.trim() === "") && parts.slice(upTo).join(d).trim() === ""
    );
  };
  const taken = (k: string) =>
    out.presetKeys.includes(k) || out.positionedKeys.includes(k) || out.namedKeys.includes(k);
  while (remaining !== null) {
    const p = cmd.positions[pos];
    if (!seenNamed && isRest(p)) {
      // rest: the remainder verbatim, named tokens no longer read
      if (remaining.trim() === "") break; // a trailing empty token
      const value = remaining.trim();
      out.userValues[p.field] = value;
      out.positionedKeys.push(p.field);
      positional += 1;
      break;
    }
    const k = remaining.indexOf(d);
    const token = k === -1 ? remaining : remaining.slice(0, k);
    remaining = k === -1 ? null : remaining.slice(k + d.length);
    if (isTrailingEmpty(token, remaining)) break;
    tokenNo += 1;
    // A blank token after a named token carries no value: skipped, no error (spec 4.4).
    if (seenNamed && token.trim() === "") continue;
    const eq = token.indexOf("=");
    if (eq > 0) {
      const name = token.slice(0, eq).trim();
      const field = byLower.get(name.toLowerCase());
      if (field !== undefined) {
        const key = field.key;
        if (taken(key)) {
          out.errors.push({
            key: "terminal.duplicateField",
            params: { field: key, labelKey: field.labelKey },
          });
        } else {
          out.userValues[key] = token.slice(eq + 1).trim();
          out.namedKeys.push(key);
        }
        seenNamed = true;
        continue;
      }
      if (seenNamed && FIELD_KEY_PATTERN.test(name)) {
        out.errors.push({ key: "terminal.unknownField", params: { name } });
        continue;
      }
    }
    if (seenNamed) {
      out.errors.push({ key: "terminal.positionalAfterNamed", params: { position: tokenNo } });
      continue;
    }
    const value = token.trim();
    positional += 1;
    if (p === undefined) {
      // an extra token past the last position: never dropped silently
      if (value !== "") overflow = true;
      continue;
    }
    const key = fieldOf(p);
    pos += 1;
    out.userValues[key] = value;
    out.positionedKeys.push(key);
  }
  if (overflow) {
    out.errors.push({
      key: "terminal.tooManyPositions",
      params: { expected: cmd.positions.length, got: positional },
    });
  }
  return out;
}
