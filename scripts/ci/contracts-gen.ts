import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SiteConfigSchema } from "@querymodule/core/config";
import {
  ROUTES,
  WsClientMessageSchema,
  WsServerMessageSchema,
  WsServerReceiptSchema,
} from "@querymodule/core/contracts";
import { z } from "zod";
import { buildOpenApiDocument, toJsonSchema } from "./openapi";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function write(rel: string, value: unknown): void {
  const file = resolve(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  console.log(`wrote ${rel}`);
}

write("packages/api/openapi.json", buildOpenApiDocument(ROUTES));

write("packages/core/contracts/ws-events.schema.json", {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Query Module WebSocket protocol v1",
  $defs: {
    WsClientMessage: toJsonSchema(WsClientMessageSchema, "input"),
    WsServerMessage: toJsonSchema(WsServerMessageSchema),
    // What a client accepts (ADR-0013 amendment, #650): an unknown status or resync reason is a
    // bounded string read as "unknown", so this is the input shape.
    WsServerReceipt: toJsonSchema(WsServerReceiptSchema, "input"),
  },
});

write("packages/config/schema/site-config.schema.json", {
  ...(z.toJSONSchema(SiteConfigSchema, { target: "draft-2020-12", io: "input" }) as Record<
    string,
    unknown
  >),
  title:
    "Query Module SiteConfig v1 (shape only; run pnpm config:validate for the referential pass)",
});
