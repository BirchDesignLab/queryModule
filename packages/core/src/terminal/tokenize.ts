import { FIELD_KEY_PATTERN, type ValidationError } from "../contracts/index.js";
import { fieldOf, isRest, namedFieldReader } from "./positions.js";
import type { TerminalConfig, TokenizeResult } from "./types.js";

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
  for (const [k, v] of Object.entries(cmd.presets ?? {})) {
    out.userValues[k] = String(v);
    out.presetKeys.push(k);
  }
  if (cut === -1) return out;

  const named = namedFieldReader(config, cmd.queryType);
  const parts = text.slice(cut + d.length).split(d);
  const blank = (x: string) => x.trim() === "";
  const lastFilled = parts.findLastIndex((x) => !blank(x));
  let pos = 0; // next CommandDef position
  let tokenNo = 0; // 1-based value token number
  let seenNamed = false;
  let positional = 0; // positional tokens before the first named one, interior empties included
  let overflow = false; // a non-empty token landed past the last position
  const restAt = cmd.positions.findIndex(isRest);
  // Before a rest position, only the tokens up to it are split: the remainder there is one
  // value (delimiters included), so a delimiter-only rest value is not a trailing empty.
  // Elsewhere a blank token is trailing when no later token is filled (one scan, linear).
  const isTrailingEmpty = (i: number, token: string) => {
    if (!blank(token)) return false;
    if (seenNamed || restAt <= pos) return i > lastFilled;
    const restStart = i + restAt - pos; // the part where the rest value begins
    return parts.slice(i + 1, restStart).every(blank) && blank(parts.slice(restStart).join(d));
  };
  // A position the command left empty does not take its field: a named token may fill it
  // (spec 4.4, #296 ruling 2). A preset takes its field whatever its value.
  const taken = (k: string) =>
    out.presetKeys.includes(k) ||
    out.namedKeys.includes(k) ||
    (out.positionedKeys.includes(k) && out.userValues[k] !== "");
  for (const [i, token] of parts.entries()) {
    const p = cmd.positions[pos];
    if (!seenNamed && isRest(p)) {
      // rest: the remainder verbatim, named tokens no longer read; a blank one is a trailing empty
      const value = parts.slice(i).join(d).trim();
      if (value !== "") {
        out.userValues[p.field] = value;
        out.positionedKeys.push(p.field);
        positional += 1;
      }
      break;
    }
    if (isTrailingEmpty(i, token)) break;
    tokenNo += 1;
    // A blank token after a named token carries no value: skipped, no error (spec 4.4).
    if (seenNamed && blank(token)) continue;
    const field = named(token);
    if (field !== undefined) {
      const key = field.key;
      if (taken(key)) {
        out.errors.push({
          key: "terminal.duplicateField",
          params: { field: key, labelKey: field.labelKey },
        });
      } else {
        out.userValues[key] = token.slice(token.indexOf("=") + 1).trim();
        // the key now comes from the named token only: the key lists stay disjoint
        out.positionedKeys = out.positionedKeys.filter((x) => x !== key);
        out.namedKeys.push(key);
      }
      seenNamed = true;
      continue;
    }
    if (seenNamed) {
      // an identifier-shaped name that is no field key is unknownField (D-B2)
      const eq = token.indexOf("=");
      const name = eq > 0 ? token.slice(0, eq).trim() : "";
      out.errors.push(
        FIELD_KEY_PATTERN.test(name)
          ? { key: "terminal.unknownField", params: { name } }
          : { key: "terminal.positionalAfterNamed", params: { position: tokenNo } },
      );
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
