import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// BR-005: the reader-facing docs stay navigable and keep up with the repository. Every phase gate
// writes a release note, and the overview must link it, so the overview is refreshed at each gate
// (CONTRIBUTING.md, "Phase gate docs refresh"). Records (ADRs, plans, reviews, release notes,
// retros, design notes) are frozen history and are not checked here.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");

const READER_DOCS = [
  "README.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "deploy/README.md",
  "apps/host-simulator/README.md",
  ...readdirSync(join(ROOT, "docs"))
    .filter((f) => f.endsWith(".md"))
    .map((f) => `docs/${f}`),
];

const MOCK_STATEMENT =
  "This runs on mock data only and is not connected to real state or national systems. It is " +
  "still built to the standard a real connection and use would demand: encryption in transit and " +
  "at rest, a complete audit trail, and security controls rooted directly in CJIS rules. Encrypted " +
  "storage for state-system credentials comes in M3.";

/** The text outside fenced code blocks, so example code is never read as links or headings. */
const prose = (text: string): string => {
  let inFence = false;
  return text
    .split("\n")
    .filter((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return false;
      }
      return !inFence;
    })
    .join("\n");
};

/** Link targets: inline `[text](target)` and reference definitions `[label]: target`. */
const links = (text: string): string[] => {
  const body = prose(text).replace(/`[^`\n]*`/g, "");
  const inline = [...body.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)].map(
    (m) => m[1] as string,
  );
  const defs = [...body.matchAll(/^\s*\[[^\]]+\]:\s*<?(\S+?)>?\s*$/gm)].map((m) => m[1] as string);
  return [...inline, ...defs];
};

/** GitHub heading anchors, github-slugger rules: lowercase, drop punctuation, space to hyphen. */
const anchors = (text: string): Set<string> => {
  const seen = new Map<string, number>();
  const out = new Set<string>();
  for (const m of prose(text).matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const base = (m[1] as string)
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .replace(/ /g, "-");
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.add(n === 0 ? base : `${base}-${n}`);
  }
  return out;
};

const isExternal = (target: string): boolean => /^[a-z][a-z0-9+.-]*:/i.test(target);

/**
 * The absolute path a link's path part points at: from the repository root when it starts with "/"
 * (as GitHub resolves it), otherwise from the doc's folder. Null when the escape is malformed.
 */
const resolveTarget = (doc: string, path: string): string | null => {
  let decoded: string;
  try {
    decoded = decodeURI(path);
  } catch {
    return null;
  }
  return decoded.startsWith("/")
    ? join(ROOT, decoded.slice(1))
    : resolve(ROOT, dirname(doc), decoded);
};

/** Relative paths each doc links to, resolved from the repository root. */
const linkedPaths = (doc: string): Set<string> =>
  new Set(
    links(read(doc))
      .filter((t) => !isExternal(t) && !t.startsWith("#"))
      .map((t) => resolveTarget(doc, t.split("#")[0] as string))
      .filter((p): p is string => p !== null)
      .map((p) => relative(ROOT, p).replaceAll("\\", "/")),
  );

const tracked = (dir: string): string[] =>
  execFileSync("git", ["ls-files", dir], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);

/** Top-level folders under dir that hold at least one tracked file. */
const trackedFolders = (dir: string): string[] => [
  ...new Set(
    tracked(dir)
      .map((f) => f.split("/"))
      .filter((parts) => parts.length > 2)
      .map((parts) => parts[1] as string),
  ),
];

describe("BR-005 reader docs: link and anchor rules", () => {
  it("resolves a repository-root link from the root, and reports a bad escape instead of throwing", () => {
    expect(resolveTarget("docs/README.md", "/docs/api.md")).toBe(join(ROOT, "docs/api.md"));
    expect(resolveTarget("docs/README.md", "api.md")).toBe(join(ROOT, "docs/api.md"));
    expect(resolveTarget("README.md", "a%2.md")).toBeNull();
  });

  it("slugs headings the way GitHub does", () => {
    const slugs = anchors("# Review tiers (ADR-0007)\n## `code` & more\n## Intro\n## Intro\n");
    expect([...slugs]).toEqual(["review-tiers-adr-0007", "code--more", "intro", "intro-1"]);
  });
});

describe("BR-005 reader docs: links", () => {
  it("every reader doc exists", () => {
    expect(READER_DOCS.filter((d) => !existsSync(join(ROOT, d)))).toEqual([]);
  });

  it("every relative link resolves to a file or folder, and every anchor to a heading", () => {
    const broken = READER_DOCS.filter((d) => existsSync(join(ROOT, d))).flatMap((doc) =>
      links(read(doc))
        .filter((t) => !isExternal(t))
        .flatMap((target) => {
          const [path = "", anchor] = target.split("#");
          const file = path === "" ? join(ROOT, doc) : resolveTarget(doc, path);
          if (file === null) return [`${doc}: ${target} (bad encoding)`];
          if (!existsSync(file)) return [`${doc}: ${target} (no such path)`];
          if (anchor === undefined || anchor === "" || statSync(file).isDirectory()) return [];
          if (!file.endsWith(".md")) return [];
          return anchors(readFileSync(file, "utf8")).has(anchor)
            ? []
            : [`${doc}: ${target} (no such heading)`];
        }),
    );
    expect(broken).toEqual([]);
  });
});

describe("BR-005 reader docs: coverage of the repository", () => {
  it("docs/README.md links every top-level doc, and every docs folder or a path inside it", () => {
    const linked = [...linkedPaths("docs/README.md")];
    const docs = readdirSync(join(ROOT, "docs"))
      .filter((f) => f.endsWith(".md") && f !== "README.md")
      .map((f) => `docs/${f}`);
    const folders = trackedFolders("docs").map((d) => `docs/${d}`);
    expect([
      ...docs.filter((p) => !linked.includes(p)),
      ...folders.filter((d) => !linked.some((p) => p === d || p.startsWith(`${d}/`))),
    ]).toEqual([]);
  });

  it("docs/architecture.md names every package, app and scripts folder", () => {
    const arch = read("docs/architecture.md");
    const expected = [
      ...trackedFolders("packages").map((d) => `packages/${d}`),
      ...trackedFolders("apps").map((d) => `apps/${d}`),
      ...trackedFolders("scripts").map((d) => `scripts/${d}`),
    ];
    expect(expected.filter((p) => !arch.includes(`\`${p}\``))).toEqual([]);
  });

  it("docs/getting-started.md names every root script", () => {
    const guide = read("docs/getting-started.md");
    const scripts = Object.keys(
      (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts,
    );
    expect(scripts.filter((s) => !guide.includes(`\`${s}\``))).toEqual([]);
  });

  it("docs/overview.md links every release note, so each phase gate refreshes it", () => {
    const linked = linkedPaths("docs/overview.md");
    const notes = readdirSync(join(ROOT, "docs/releases"))
      .filter((f) => f.endsWith(".md"))
      .map((f) => `docs/releases/${f}`);
    expect(notes.filter((n) => !linked.has(n))).toEqual([]);
  });
});

describe("BR-005 reader docs: mock data only (developer ruling)", () => {
  it("README, overview and SECURITY carry the mock-data statement word for word", () => {
    const flat = (doc: string): string => read(doc).replace(/^>\s?/gm, "").replace(/\s+/g, " ");
    expect(
      ["README.md", "docs/overview.md", "SECURITY.md"].filter(
        (d) => !flat(d).includes(MOCK_STATEMENT),
      ),
    ).toEqual([]);
  });

  it("README links the index, the community files and the license", () => {
    const linked = linkedPaths("README.md");
    expect(
      ["docs/README.md", "CONTRIBUTING.md", "SECURITY.md", "LICENSE"].filter((p) => !linked.has(p)),
    ).toEqual([]);
  });
});
