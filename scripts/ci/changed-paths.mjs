import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** @param {string[]} files */
export function isDocsOnly(files) {
  return files.length > 0 && files.every((f) => f.startsWith("docs/") || f.endsWith(".md"));
}

function main() {
  const base = process.env.BASE_SHA ?? "";
  const head = process.env.HEAD_SHA ?? "HEAD";
  if (base === "" || /^0+$/.test(base)) {
    console.log("docs_only=false");
    return;
  }
  const out = execFileSync("git", ["diff", "--name-only", `${base}...${head}`], {
    encoding: "utf8",
  });
  const files = out
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  console.log(`docs_only=${isDocsOnly(files)}`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
