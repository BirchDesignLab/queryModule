import type { ApiClient } from "../api/create-api-client.js";

function core(version: string): [number, number, number] {
  const [main = ""] = version.split(/[-+]/);
  const parts = main.split(".").map((p) => Number.parseInt(p, 10));
  const at = (i: number): number => {
    const n = parts[i];
    return n === undefined || Number.isNaN(n) ? 0 : n;
  };
  return [at(0), at(1), at(2)];
}

/** Compares major.minor.patch; pre-release and build suffixes are ignored. */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = core(a);
  const pb = core(b);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

export function isClientSupported(
  clientVersion: string,
  minClientVersion: string | null | undefined,
): boolean {
  if (minClientVersion === null || minClientVersion === undefined || minClientVersion === "")
    return true;
  return compareSemver(clientVersion, minClientVersion) >= 0;
}

export async function fetchMeta(api: ApiClient) {
  const { data } = await api.GET("/api/v1/meta");
  if (data === undefined) throw new Error("metaUnavailable");
  return data;
}
