#!/usr/bin/env bash
# PostToolUse (Write|Edit): eslint --fix the edited TS file; report errors it cannot fix back to Claude.
f=$(jq -r '.tool_input.file_path // .tool_response.filePath // ""')
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
case "$f" in
  "$root"/src/*.ts|"$root"/src/*.tsx|"$root"/scripts/*.ts) ;;
  *) exit 0 ;;
esac
[[ -f "$f" ]] || exit 0
cd "$root" || exit 0
if ! out=$(npx --no-install eslint --fix --quiet "$f" 2>&1); then
  printf 'ESLint errors remain in %s:\n%s\n' "${f#"$root"/}" "$out" >&2
  exit 2
fi
exit 0
