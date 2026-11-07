# Claude Terminal Assistant: prints a line above the bash prompt that shows whether this terminal
# is the voice target. Sourced from ~/.bashrc (Settings > Connect Claude Code, or npm run
# install-prompt). It runs src/statusline.cjs through the launcher the app writes at every start
# (the app's own exe in Node mode, so no Node.js is needed), or with node from a source checkout.

__tch_script="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/src/statusline.cjs"
__tch_launcher=""
if [ -n "$APPDATA" ] && command -v cygpath >/dev/null 2>&1; then
  __tch_launcher="$(cygpath -u "$APPDATA")/claude-terminal-assistant/bin/statusline.cmd"
fi

__tch_status() {
  local exit_code=$?
  local state=""
  if [ -n "$__tch_launcher" ] && [ -f "$__tch_launcher" ]; then
    state="$("$__tch_launcher" --plain 2>/dev/null)"
  elif command -v node >/dev/null 2>&1; then
    state="$(node "$__tch_script" --plain 2>/dev/null)"
  fi
  if [ "$state" = selected ]; then
    printf '\033[38;2;255;122;26m\342\227\217 Selected\033[0m\n' # the app's ember accent
  elif [ -n "$state" ]; then
    printf '\033[90m\342\227\213 Not selected\033[0m\n'
  fi
  return $exit_code # keep $? for the rest of PROMPT_COMMAND and PS1
}

case ";$PROMPT_COMMAND;" in
  *__tch_status*) ;;
  *) PROMPT_COMMAND="__tch_status${PROMPT_COMMAND:+; $PROMPT_COMMAND}" ;;
esac
