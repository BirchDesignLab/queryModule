#!/usr/bin/env bash
# task-brief.sh: extract one "### Task N:" section of an implementation plan
# into a brief file the implementer reads in one call (ADR-0006).
#
# Usage (Git Bash on Windows, bash on Linux):
#   bash scripts/sdd/task-brief.sh PLAN N OUT
#   bash scripts/sdd/task-brief.sh docs/superpowers/plans/2026-09-25-p0-contracts.md 7 \
#     .superpowers/sdd/2026-09-25-p0-contracts/task-7-brief.md
#
# The section starts at the heading "Task N" (followed by ":" or any non-digit)
# and ends before the next heading of the same or a higher level (for a
# "### Task N:" heading: the next "#", "##" or "###" heading). Headings inside
# fenced code blocks (``` or ~~~, any length, any info string) are ignored, so
# a "# comment" line in a bash or markdown fence neither starts nor ends a
# section. A fence closes only on a bare run of the same character at least as
# long as the one that opened it (CommonMark rule).
#
# Our own awk, equivalent to the superpowers SDD task-brief script, committed
# so any session can run it without the plugin path.
# Exit codes: 0 written, 2 usage or missing plan, 3 task not found.
set -euo pipefail

if [ $# -ne 3 ]; then
  echo "usage: bash scripts/sdd/task-brief.sh PLAN N OUT" >&2
  exit 2
fi

plan=$1
n=$2
out=$3
[ -f "$plan" ] || { echo "no such plan file: $plan" >&2; exit 2; }
case "$n" in
  ''|*[!0-9]*) echo "task number must be a positive integer: $n" >&2; exit 2 ;;
esac

mkdir -p "$(dirname "$out")"

awk -v n="$n" '
  function fence_run(s,   m) {
    # Returns the fence marker run ("```", "~~~~", ...) at the start of s
    # (after up to 3 spaces of indent), or "" when s is not a fence line.
    if (match(s, /^ ? ? ?(```+|~~~+)/)) {
      m = substr(s, RSTART, RLENGTH)
      sub(/^ +/, "", m)
      return m
    }
    return ""
  }
  {
    line = $0
    sub(/\r$/, "", line)
    run = fence_run(line)
    if (infence) {
      if (run != "" && substr(run, 1, 1) == fchar && length(run) >= flen) {
        rest = line
        sub(/^ ? ? ?(```+|~~~+)/, "", rest)
        if (rest ~ /^[ \t]*$/) { infence = 0 }
      }
      if (intask) print
      next
    }
    if (run != "") {
      infence = 1
      fchar = substr(run, 1, 1)
      flen = length(run)
      if (intask) print
      next
    }
    if (match(line, /^#+[ \t]/)) {
      level = RLENGTH - 1
      if (intask && level <= tlevel) { exit }
      if (!intask && line ~ ("^#+[ \t]+Task[ \t]+" n "([^0-9]|$)")) {
        intask = 1
        tlevel = level
      }
    }
    if (intask) print
  }
' "$plan" > "$out"

if [ ! -s "$out" ]; then
  echo "task ${n} not found in ${plan} (no heading matching 'Task ${n}')" >&2
  rm -f "$out"
  exit 3
fi

echo "wrote ${out}: $(wc -l < "$out" | tr -d ' ') lines"
