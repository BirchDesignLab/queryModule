import type { ValidationError } from "../contracts/index.js";
import { type EvaluateOptions, evaluateForm, type FormState } from "../rules/index.js";
import { mergeDraft } from "./draft.js";
import { enrichErrors } from "./parse.js";
import { tokenize } from "./tokenize.js";
import type { Draft, TerminalConfig, TokenizeResult } from "./types.js";

export interface TerminalSubmitCheck {
  tokenized: TokenizeResult;
  queryType?: string;
  /** mergeDraft(drafts[queryType] ?? {}, tokenized, config); undefined when no command matched. */
  merged?: Draft;
  /** evaluateForm on `merged`, not on the command's values alone (#297 item 3). */
  formState?: FormState;
  /**
   * Tokenize errors, then validation errors of `formState` enriched with labelKey and 1-based
   * position, then terminal.valueForHiddenField for typed (positioned or named) keys in
   * formState.hiddenWithValue.
   */
  errors: ValidationError[];
}

/**
 * Spec 4.4 draft merge and FR-053: what Enter in the terminal would submit. The caller passes
 * every query type's draft (one per type, spec 6.7); this picks the command's own type, since
 * mergeDraft cannot check it (#297 item 4). Submit only when errors is empty and
 * formState.valid. Pure: `now` is passed in.
 */
export function checkTerminalSubmit(
  config: TerminalConfig,
  input: string,
  drafts: Readonly<Record<string, Draft>>,
  options: EvaluateOptions,
): TerminalSubmitCheck {
  const tokenized = tokenize(config, input);
  const { queryType, commandCode } = tokenized;
  if (queryType === undefined || commandCode === undefined)
    return { tokenized, errors: tokenized.errors };

  // Own keys only: a type named like an Object.prototype key must not read an inherited draft.
  const draft = Object.hasOwn(drafts, queryType) ? (drafts[queryType] ?? {}) : {};
  const merged = mergeDraft(draft, tokenized, config);
  const formState = evaluateForm(config, queryType, merged, options);
  const typed = [...tokenized.positionedKeys, ...tokenized.namedKeys];
  return {
    tokenized,
    queryType,
    merged,
    formState,
    errors: [...tokenized.errors, ...enrichErrors(config, commandCode, formState, typed)],
  };
}
