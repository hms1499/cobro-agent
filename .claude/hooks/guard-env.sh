#!/usr/bin/env bash
# PreToolUse (Read|Bash): refuse to read or print secret env files (.env, .env.local, ...).
# .env.example is allowed. Counting or listing names (grep -c/-q/-l/-o) stays allowed.
input=$(cat)
tool=$(jq -r '.tool_name' <<<"$input")

deny() {
  jq -n --arg r "$1" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $r}}'
  exit 0
}

if [[ "$tool" == "Read" ]]; then
  name=$(basename "$(jq -r '.tool_input.file_path // ""' <<<"$input")")
  if [[ "$name" =~ ^\.env(\..+)?$ && "$name" != ".env.example" ]]; then
    deny "Blocked: $name holds secrets. Check variable names or lengths with grep -c / awk instead of reading values."
  fi
  exit 0
fi

if [[ "$tool" == "Bash" ]]; then
  cmd=$(jq -r '.tool_input.command // ""' <<<"$input")
  # Mentions a secret env file (not .env.example)?
  if grep -qE '(^|[[:space:]/"'"'"'])\.env(\.(local|production|development|test|production\.local|development\.local))?([[:space:]"'"'"';|)]|$)' <<<"$cmd"; then
    if grep -qE '(^|[;&|[:space:]])(cat|less|more|head|tail|bat|nl|strings|od|xxd|hexdump|vim?|nano|code|open|pbcopy)([[:space:]]|$)' <<<"$cmd"; then
      deny "Blocked: this command would print a secret env file. Print names, lengths or host prefixes only (see CLAUDE.md, Secrets)."
    fi
    if grep -qE '(^|[;&|[:space:]])(e|f)?grep[[:space:]]' <<<"$cmd" && ! grep -qE '(^|[;&|[:space:]])(e|f)?grep[[:space:]]+(-[a-zA-Z]*[cqlLo][a-zA-Z]*)' <<<"$cmd"; then
      deny "Blocked: grep on a secret env file prints values. Use grep -c, -q, -l or -o '^[A-Z0-9_]+=' instead."
    fi
  fi
fi
exit 0
