import { type PersonaResolution, resolvePersona } from "@querymodule/client";
import { useMediaQuery } from "../hooks/useMediaQuery.js";

/** Web heuristic input is `(any-pointer: coarse)` only; width never selects a persona (spec 6.1). */
export function usePersona(hostPersona: string | null, override: string | null): PersonaResolution {
  const coarsePointer = useMediaQuery("(any-pointer: coarse)");
  return resolvePersona({ hostPersona, override, platform: "web", coarsePointer });
}
