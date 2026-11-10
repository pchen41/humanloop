// Humanloop's zsh integration. Tabs' shells are pointed at a folder of
// startup files (via ZDOTDIR) that run your own .zshenv, .zprofile and .zshrc
// from your usual folder, unchanged, then:
// - wrap `claude` so it gets Humanloop's hooks with --settings, and
// - add two hooks that print a mark as each command starts and as each
//   prompt appears (for command tracking).
// Nothing in your own files is changed, and once startup is done ZDOTDIR is
// back to what it was, so programs and nested shells see your normal setup.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const HEADER = `# Written by Humanloop for its terminal tabs; rewritten at each launch.
# It runs your own startup file of the same name, unchanged.
`;

/** Runs your own file of this name from your ZDOTDIR (or home), noting any ZDOTDIR it sets. */
const runYours = (file: string) => `ZDOTDIR=$HUMANLOOP_USER_ZDOTDIR
[[ -r $ZDOTDIR/${file} ]] && builtin source "$ZDOTDIR/${file}"
HUMANLOOP_USER_ZDOTDIR=$ZDOTDIR
ZDOTDIR=$HUMANLOOP_ZDOTDIR
`;

const FILES: Record<string, string> = {
  // Without a ZDOTDIR of your own, your .zshenv runs with none set, so a
  // default it sets (${ZDOTDIR:=~/.config/zsh}) takes effect as usual.
  '.zshenv': `${HEADER}
if [[ -n \${HUMANLOOP_HAD_ZDOTDIR-} ]]; then ZDOTDIR=$HUMANLOOP_USER_ZDOTDIR; else unset ZDOTDIR; fi
[[ -r \${ZDOTDIR:-$HOME}/.zshenv ]] && builtin source "\${ZDOTDIR:-$HOME}/.zshenv"
[[ -n \${ZDOTDIR+x} ]] && HUMANLOOP_HAD_ZDOTDIR=1
HUMANLOOP_USER_ZDOTDIR=\${ZDOTDIR:-$HOME}
ZDOTDIR=$HUMANLOOP_ZDOTDIR
`,
  '.zprofile': `${HEADER}
${runYours('.zprofile')}`,
  // The last file Humanloop's folder provides: zsh reads .zlogin from your folder itself.
  // macOS's /etc/zshrc ran just before this with ZDOTDIR pointing here: put
  // back what it set from it, history first.
  '.zshrc': `${HEADER}
[[ $HISTFILE == $HUMANLOOP_ZDOTDIR/.zsh_history ]] && HISTFILE=$HUMANLOOP_USER_ZDOTDIR/.zsh_history
[[ -r $HUMANLOOP_USER_ZDOTDIR/.zkbd/$TERM-$VENDOR ]] && builtin source "$HUMANLOOP_USER_ZDOTDIR/.zkbd/$TERM-$VENDOR"
${runYours('.zshrc')}
if [[ -n \${HUMANLOOP_HAD_ZDOTDIR-} || $HUMANLOOP_USER_ZDOTDIR != $HOME ]]; then
  export ZDOTDIR=$HUMANLOOP_USER_ZDOTDIR
else
  unset ZDOTDIR
fi
unset HUMANLOOP_ZDOTDIR HUMANLOOP_USER_ZDOTDIR HUMANLOOP_HAD_ZDOTDIR

# claude gets Humanloop's hooks for this session; your own hooks still run.
# - An alias to claude itself (claude --flags) is kept: it runs the wrapper.
# - An alias to somewhere else (a path) gets the hooks after its own options.
# - A claude function of yours gets them in front of its arguments, keeping its name.
if [[ -n \${HUMANLOOP_CLAUDE_SETTINGS-} ]]; then
  typeset -g __humanloop_claude_settings=$HUMANLOOP_CLAUDE_SETTINGS
  unset HUMANLOOP_CLAUDE_SETTINGS
  if (( $+aliases[claude] )) && [[ \${\${(z)aliases[claude]}[1]} != claude ]]; then
    aliases[claude]+=' --settings "$__humanloop_claude_settings"'
  elif (( $+functions[claude] )); then
    functions[claude]='set -- --settings "$__humanloop_claude_settings" "$@"'$'\\n'$functions[claude]
  else
    function claude { command claude --settings "$__humanloop_claude_settings" "$@" }
  fi
fi

# Marks for command tracking: the command line as it starts (control
# characters dropped, cut to 200 characters), and its exit status at the next
# prompt (zsh gives every prompt hook the command's $?).
autoload -Uz add-zsh-hook
__humanloop_preexec() { builtin print -rn -- $'\\e]6973;C;'"\${\${1//[[:cntrl:]]/ }[1,200]}"$'\\a' }
__humanloop_precmd() { builtin print -rn -- $'\\e]6973;D;'"$?"$'\\a' }
add-zsh-hook preexec __humanloop_preexec
add-zsh-hook precmd __humanloop_precmd
`,
};

/**
 * Writes the startup files into `dir`. Returns false if they couldn't be
 * written: then tabs start without them, since pointing zsh at a folder
 * without them would skip your own startup files.
 */
export function writeZshIntegration(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    for (const [name, text] of Object.entries(FILES)) writeFileSync(join(dir, name), text, { mode: 0o644 });
    return true;
  } catch (err) {
    console.error(`Could not write the shell integration to ${dir}:`, err);
    return false;
  }
}

/**
 * The variables that point a new tab's zsh at the integration, given the
 * environment it would get, and the settings (hooks) to give `claude`.
 */
export function zshIntegrationEnv(dir: string, env: Record<string, string>, claudeSettings: string): Record<string, string> {
  const out: Record<string, string> = { ZDOTDIR: dir, HUMANLOOP_ZDOTDIR: dir, HUMANLOOP_CLAUDE_SETTINGS: claudeSettings };
  if (env.ZDOTDIR) {
    out.HUMANLOOP_USER_ZDOTDIR = env.ZDOTDIR;
    out.HUMANLOOP_HAD_ZDOTDIR = '1';
  }
  return out;
}
