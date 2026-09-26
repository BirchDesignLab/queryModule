import { MILESTONES, type Milestone } from "@querymodule/core/contracts";
import { z } from "zod";

export const StoryRowSchema = z.strictObject({
  story: z.string().regex(/^[ABC]\d$/),
  milestone: z.union([z.enum(MILESTONES), z.literal("later")]),
  files: z.array(z.string().min(1)).min(1),
});
export type StoryRow = z.infer<typeof StoryRowSchema>;
export const StoriesFileSchema = z.array(StoryRowSchema);

export function highestMilestoneTag(tags: string[]): Milestone | null {
  let best = -1;
  for (const t of tags) {
    const i = (MILESTONES as readonly string[]).indexOf(t);
    if (i > best) best = i;
  }
  return best < 0 ? null : (MILESTONES[best] ?? null);
}

export function storiesInScope(
  rows: StoryRow[],
  opts: { highestTag: Milestone | null; milestone?: Milestone },
): StoryRow[] {
  return rows.filter((r) => {
    if (r.milestone === "later") return false;
    if (opts.milestone) return r.milestone === opts.milestone;
    if (opts.highestTag === null) return false;
    return MILESTONES.indexOf(r.milestone) <= MILESTONES.indexOf(opts.highestTag);
  });
}

export function hasTaggedTest(text: string, story: string): boolean {
  const title = new RegExp(
    `\\b(?:it|test|describe)(?:\\.\\w+)*\\(\\s*["'\`][^"'\`\\n]*\\[${story}\\]`,
  );
  return title.test(text);
}

export function checkStoryTags(
  rows: StoryRow[],
  opts: { highestTag: Milestone | null; milestone?: Milestone },
  readFile: (path: string) => string | undefined,
): string[] {
  const failures: string[] = [];
  for (const row of storiesInScope(rows, opts)) {
    const found = row.files.some((f) => {
      const text = readFile(f);
      return text !== undefined && hasTaggedTest(text, row.story);
    });
    if (!found)
      failures.push(
        `${row.story} (${row.milestone}): no test titled with [${row.story}] in ${row.files.join(", ")}`,
      );
  }
  return failures;
}
