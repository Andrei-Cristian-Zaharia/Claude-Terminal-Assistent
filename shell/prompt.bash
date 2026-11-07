# Terminal Claude Helper: prints a line above the bash prompt that shows whether this terminal
# is the voice target. Sourced from ~/.bashrc by scripts/install-prompt.cjs.

__tch_script="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/src/statusline.cjs"

__tch_status() {
  local exit_code=$?
  if command -v node >/dev/null 2>&1; then
    if [ "$(node "$__tch_script" --plain 2>/dev/null)" = selected ]; then
      printf '\033[38;2;255;122;26m\342\227\217 Selected\033[0m\n' # the app's ember accent
    else
      printf '\033[90m\342\227\213 Not selected\033[0m\n'
    fi
  fi
  return $exit_code # keep $? for the rest of PROMPT_COMMAND and PS1
}

case ";$PROMPT_COMMAND;" in
  *__tch_status*) ;;
  *) PROMPT_COMMAND="__tch_status${PROMPT_COMMAND:+; $PROMPT_COMMAND}" ;;
esac
