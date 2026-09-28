import type { CommandDef } from "../config/schema";
import type { ValidationError } from "../contracts/validation-error";
import type { FormState, RulesConfig } from "../rules/types";

/** SiteConfig and ClientSiteConfig both satisfy it. */
export interface TerminalConfig extends RulesConfig {
  commands: readonly CommandDef[];
  terminal: { delimiter: string };
}

/** Spec 4.4 TokenizeResult, plus presetKeys and namedKeys (D-B5). */
export interface TokenizeResult {
  /** The CommandDef code as configured. */
  commandCode?: string;
  queryType?: string;
  /** Raw strings as typed (spec 4.4). */
  userValues: Record<string, string>;
  /** Fields filled by a positional token, empty ones included. */
  positionedKeys: string[];
  /** Additions to the spec shape: the draft merge and the duplicate check need to know how each key was set. */
  presetKeys: string[];
  namedKeys: string[];
  errors: ValidationError[];
}

export interface ParseResult {
  queryType?: string;
  userValues: Record<string, string>;
  formState?: FormState;
  errors: ValidationError[];
}

export interface FormatResult {
  text: string;
  errors: ValidationError[];
  unshownCount: number;
}

export type Draft = Readonly<Record<string, string | number | boolean | null>>;
