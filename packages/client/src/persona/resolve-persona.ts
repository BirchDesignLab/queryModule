export interface PersonaInput {
  hostPersona: string | null;
  override: string | null;
  platform: "web" | "native";
  /** `(any-pointer: coarse)`; width is never an input (spec 6.1). */
  coarsePointer: boolean;
}

export interface PersonaResolution {
  persona: string;
  source: "host" | "override" | "heuristic";
  /** Only the web heuristic follows pointer changes; host and override disable re-evaluation. */
  reevaluateOnPointerChange: boolean;
}

function heuristic(platform: "web" | "native", coarsePointer: boolean): string {
  if (platform === "native") return "mobile";
  if (coarsePointer) return "mobileUnit";
  return "dispatch";
}

export function resolvePersona(input: PersonaInput): PersonaResolution {
  if (input.hostPersona !== null)
    return { persona: input.hostPersona, source: "host", reevaluateOnPointerChange: false };
  if (input.override !== null)
    return { persona: input.override, source: "override", reevaluateOnPointerChange: false };
  return {
    persona: heuristic(input.platform, input.coarsePointer),
    source: "heuristic",
    reevaluateOnPointerChange: input.platform === "web",
  };
}
