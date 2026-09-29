import { fetchLocaleBundle, LocaleUnavailableError } from "@querymodule/client";
import { createContext, useEffect, useMemo, useState } from "react";
import { useT } from "../app/i18n-context.js";
import { useServices } from "../app/services-context.js";
import type { useDraft } from "./builder-store.js";
import {
  flattenBundle,
  type JsonObject,
  type PathSegment,
  toPointer,
  validateDraft,
} from "./draft.js";
import { type DraftIssue, draftIssues, groupByControl } from "./issues.js";

export interface DraftChecks {
  status: BundleState["status"];
  issues: readonly DraftIssue[];
  groups: ReadonlyMap<string, readonly DraftIssue[]>;
  /** Issues by their own pointer, built once per check (#388 M4: controls look up, not filter). */
  byPointer: ReadonlyMap<string, readonly DraftIssue[]>;
  /** The settled (debounced) draft the issues were computed on; the preview renders this one. */
  doc: JsonObject | null;
  labels: ReturnType<typeof useDraft>["labels"];
}

const NO_CHECKS: DraftChecks = {
  status: "loading",
  issues: [],
  groups: new Map(),
  byPointer: new Map(),
  doc: null,
  labels: {},
};
export const ChecksContext = createContext<DraftChecks>(NO_CHECKS);
const CHECK_DEBOUNCE_MS = 150;

function useDebounced<T>(value: T, ms: number): T {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setShown(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return shown;
}

/** validateSiteConfig on every draft change, debounced, with diagnostics grouped by control. */
export function useDraftChecks(
  doc: JsonObject,
  labels: ReturnType<typeof useDraft>["labels"],
): DraftChecks {
  const settledDoc = useDebounced(doc, CHECK_DEBOUNCE_MS);
  const locales = Array.isArray(settledDoc.locales)
    ? settledDoc.locales.filter((l): l is string => typeof l === "string")
    : [];
  const bundleState = useLocaleBundles(locales.join(","));
  const settledLabels = useDebounced(labels, CHECK_DEBOUNCE_MS);
  return useMemo(() => {
    const settled = { doc: settledDoc, labels: settledLabels };
    if (bundleState.status !== "ready")
      return { ...NO_CHECKS, ...settled, status: bundleState.status };
    const issues = draftIssues(
      validateDraft(settledDoc, settledLabels, bundleState.bundle, bundleState.perLocale),
    );
    const byPointer = new Map<string, DraftIssue[]>();
    for (const i of issues) byPointer.set(i.pointer, [...(byPointer.get(i.pointer) ?? []), i]);
    const groups = groupByControl(settledDoc, issues);
    return { status: "ready", issues, groups, byPointer, ...settled };
  }, [bundleState, settledDoc, settledLabels]);
}

export const isError = (issues: readonly DraftIssue[] | undefined): boolean =>
  issues?.some((i) => i.level === "error") ?? false;

/** The messages of one control, linked by its aria-describedby (UX-004). */
export function IssueMessages({
  id,
  issues,
}: {
  id: string;
  issues: readonly DraftIssue[] | undefined;
}) {
  const t = useT();
  if (issues === undefined || issues.length === 0) return null;
  return (
    <span id={id} className="qm-admin__issues">
      {issues.map((issue) => (
        <span
          key={`${issue.pointer}:${issue.key}:${JSON.stringify(issue.params)}`}
          className={`qm-admin__issue qm-admin__issue--${issue.level}`}
        >
          {" "}
          {t(issue.level === "error" ? "admin.config.level.error" : "admin.config.level.warning")}{" "}
          {t(issue.key, issue.params)}
        </span>
      ))}
    </span>
  );
}

export const issuesFor = (checks: DraftChecks, path: readonly PathSegment[]) =>
  checks.groups.get(toPointer(path));

type BundleState =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "ready";
      bundle: Record<string, string>;
      perLocale: Record<string, Record<string, string>>;
    };

/**
 * The shipped strings of every draft locale, for validating label keys, fetched through the query
 * cache (bootstrap already cached the English one, #388). English must load; another locale with
 * no shipped bundle (404) is checked on its overlay alone, so its missing labels show (#388); any
 * other failure is a load error (#404).
 */
function useLocaleBundles(localesKey: string): BundleState {
  const { api, queryClient } = useServices();
  const [state, setState] = useState<BundleState>({ status: "loading" });
  useEffect(() => {
    let live = true;
    const load = (locale: string) =>
      queryClient
        .fetchQuery({
          queryKey: ["locale", locale],
          queryFn: () => fetchLocaleBundle(api, locale),
          staleTime: Number.POSITIVE_INFINITY,
          // A locale with no shipped bundle answers 404: no retry backoff before the checks run.
          retry: false,
        })
        .then(flattenBundle);
    const others = localesKey.split(",").filter((l) => l !== "" && l !== "en");
    Promise.all([
      load("en"),
      ...others.map((l) =>
        load(l)
          // Only "no such bundle" (404) means the locale ships nothing; any other failure is a
          // load error and pauses the checks (#404).
          .catch((error: unknown) =>
            error instanceof LocaleUnavailableError && error.status === 404
              ? {}
              : Promise.reject(error),
          )
          .then((b) => [l, b] as const),
      ),
    ])
      .then(([en, ...rest]) => {
        const perLocale = Object.fromEntries(rest as (readonly [string, Record<string, string>])[]);
        if (live) setState({ status: "ready", bundle: en as Record<string, string>, perLocale });
      })
      .catch(() => {
        if (live) setState({ status: "error" });
      });
    return () => {
      live = false;
    };
  }, [api, queryClient, localesKey]);
  return state;
}
