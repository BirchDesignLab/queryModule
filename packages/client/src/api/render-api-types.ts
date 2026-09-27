import openapiTS, { astToString } from "openapi-typescript";

const HEADER =
  "// Generated from packages/api/openapi.json by pnpm --filter @querymodule/client gen:api. Do not edit.\n";

/** Dev-only: used by the generator script and its drift test; not exported from the package. */
export async function renderApiTypes(): Promise<string> {
  const ast = await openapiTS(new URL("../../../api/openapi.json", import.meta.url));
  return HEADER + astToString(ast);
}
