import type { JsonObject } from "./draft.js";
import { TryMatchPane } from "./TryMatchPane.js";

/**
 * The right pane on a mock item: Try a match (#565), which replaced the static note BW2 shipped
 * (Q3, developer 10-05-26). It reads the draft's mock and sends nothing.
 */
export function MockPane({ doc, selected }: { doc: JsonObject; selected: string | null }) {
  return <TryMatchPane doc={doc} selected={selected} />;
}
