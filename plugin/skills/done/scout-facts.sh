#!/bin/bash
# scout-facts.sh — the scout's measurements, in seconds, so its agent only has to judge.
# Usage: scout-facts.sh file1 file2 ...   (the session files)
#
# Prints, per session source file: lines, whether a test sits beside it, escape-hatch lines (any,
# `as` casts, `!`, ts-ignore, lint disables), and whether the eslint config names it (a per-file
# override that may now be removable). Then the long or complex functions eslint finds in them,
# and the repo's five longest source files. Never edits anything.

start=$(date +%s)
SRC='\.(ts|tsx|js|jsx|mjs|cjs|py)$'
FILES=()
for f in "$@"; do
  [ -f "$f" ] && echo "$f" | grep -Eq "$SRC" && FILES+=("$f")
done
CONFIG=$(cat eslint.config.* .eslintrc* 2>/dev/null)

echo "=== Session files ==="
for f in "${FILES[@]}"; do
  lines=$(wc -l < "$f" | tr -d ' ')
  base="${f%.*}"; ext="${f##*.}"
  case "$f" in
    *.test.*|*.spec.*) test="(a test)" ;;
    *) if [ -f "$base.test.$ext" ] || [ -f "$base.spec.$ext" ]; then test="tested"; else test="NO TEST BESIDE IT"; fi ;;
  esac
  hatches=$(grep -cE '\bas\s+any\b|:\s*any\b|<any>|@ts-(ignore|nocheck|expect-error)|eslint-disable|\bas\s+[A-Z][A-Za-z]+|[A-Za-z0-9_)]!\.' "$f")
  override=""
  printf '%s\n' "$CONFIG" | grep -qF "\"$f\"" && override=", named in the eslint config (override still needed?)"
  echo "$f: $lines lines, $test, $hatches escape-hatch lines$override"
done

if [ ${#FILES[@]} -gt 0 ] && [ -x node_modules/.bin/eslint ]; then
  echo ""
  echo "=== Long or complex functions (eslint) ==="
  node_modules/.bin/eslint --no-warn-ignored -f json \
    --rule '{"max-lines-per-function":["warn",{"max":60,"skipBlankLines":true,"skipComments":true}],"complexity":["warn",12],"max-depth":["warn",4],"max-params":["warn",4]}' \
    "${FILES[@]}" 2>/dev/null | node -e '
      let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
        let rows = [];
        try { rows = JSON.parse(s); } catch { return console.log("(eslint output unreadable)"); }
        const want = new Set(["max-lines-per-function", "complexity", "max-depth", "max-params", "max-lines"]);
        let n = 0;
        for (const r of rows) for (const m of r.messages)
          if (want.has(m.ruleId)) { n++; console.log(`${r.filePath.replace(process.cwd() + "/", "")}:${m.line} ${m.message}`); }
        if (!n) console.log("(none)");
      });'
fi

echo ""
echo "=== Five longest source files in the repo ==="
git ls-files 2>/dev/null | grep -E "$SRC" | grep -vE '(^|/)(node_modules|dist|build|\.next)/' \
  | tr '\n' '\0' | xargs -0 wc -l 2>/dev/null | grep -v ' total$' | sort -rn | head -5

echo ""
echo "=== scout-facts: $(( $(date +%s) - start ))s ==="
