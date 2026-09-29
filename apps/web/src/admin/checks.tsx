import { fetchLocaleBundle } from "@querymodule/client";
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
  /** The settled (debounced) draft the issues were computed on; the preview renders this one. */
  doc: JsonObject | null;
  labels: ReturnType<typeof useDraft>["labels"];
}

const NO_CHECKS: DraftChecks = {
  status: "loading",
  issues: [],
  groups: new Map(),
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
  const bundleState = useEnglishBundle();
  const settledDoc = useDebounced(doc, CHECK_DEBOUNCE_MS);
  const settledLabels = useDebounced(labels, CHECK_DEBOUNCE_MS);
  return useMemo(() => {
    const settled = { doc: settledDoc, labels: settledLabels };
    if (bundleState.status !== "ready")
      return { ...NO_CHECKS, ...settled, status: bundleState.status };
    const issues = draftIssues(validateDraft(settledDoc, settledLabels, bundleState.bundle));
    return { status: "ready", issues, groups: groupByControl(settledDoc, issues), ...settled };
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
          className="qm-admin__issue"
        >
          {" "}
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
  | { status: "ready"; bundle: Record<string, string> };

/** The shipped English strings, for validating label keys; fetched through the query cache. */
function useEnglishBundle(): BundleState {
  const { api, queryClient } = useServices();
  const [state, setState] = useState<BundleState>({ status: "loading" });
  useEffect(() => {
    let live = true;
    queryClient
      .fetchQuery({
        queryKey: ["locale", "en"],
        queryFn: () => fetchLocaleBundle(api, "en"),
        staleTime: Number.POSITIVE_INFINITY,
      })
      .then((b) => {
        if (live) setState({ status: "ready", bundle: flattenBundle(b) });
      })
      .catch(() => {
        if (live) setState({ status: "error" });
      });
    return () => {
      live = false;
    };
  }, [api, queryClient]);
  return state;
}
