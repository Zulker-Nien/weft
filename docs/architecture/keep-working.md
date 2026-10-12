# Keep Working

The menu bar icon's switch for keeping the Mac awake with the lid shut, so threads keep running in a bag.
macOS only (`createMenus` builds it when `mac` is true).

## Why `pmset`

Shutting the lid forces sleep whatever `caffeinate` or Electron's `powerSaveBlocker` say. Only
`pmset -a disablesleep 1` overrides it: no sleep, no hibernate, Wi-Fi stays up, jobs keep going. That needs root.

## Key files

- `electron/keep-working.cjs`: state, the sudoers install, the watchdog, and the pure pieces the menu is built from
  (`trayTitle`, `statusText`, `menuTemplate`, `sudoersLine`).
- `electron/menus.cjs`: creates it (`menus.keepWorking`), puts `☕︎` and the hours left in the tray title next to the
  needs-you count, and adds the **Keep Working ▸** submenu above Open Weft.
- `electron/main.cjs`: calls `menus.keepWorking.stopSync()` on `will-quit`.
- `electron/keep-working.test.ts`: the pure pieces. The process parts (sudo, osascript, the watchdog) aren't tested.

## Modes

| Mode | Ends when |
| --- | --- |
| Until threads finish | no card has been in Running for 2 checks a minute apart, or after 8 hours |
| For 1, 2, 3 or 8 hours | the time runs out |

Both also end at 10% battery on battery power, on **Off**, and when Weft quits. `countRunning()` reads
`/api/cards` from the board's server; if it can't, it returns `null` and the idle count resets, so a server hiccup
never switches sleep back on early.

## One-time permission

`start()` checks `sudo -n -l pmset -a disablesleep 1`. If that isn't allowed, `installRule()` writes
`<user> ALL=(root) NOPASSWD: /usr/bin/pmset -a disablesleep 0, /usr/bin/pmset -a disablesleep 1` to a temp file,
validates it with `visudo -cf`, and installs it as `/etc/sudoers.d/weft-keep-working` through `osascript … with
administrator privileges` (macOS's own password dialog). Cancelling is silent. Nothing else is granted.
Any rule that already allows those two commands works: the `travel` script's `/etc/sudoers.d/travel` does.

## Safety net

A detached `bash` watchdog is spawned with the deadline, Weft's pid and the battery floor. Every 30 s it checks the
clock, whether Weft's pid is alive, and the battery; on any exit condition it runs `sudo -n pmset -a disablesleep 0`.
So a crash or `kill -9` of Weft can't leave the Mac unable to sleep. A normal quit restores sleep first
(`stopSync`, 5 s timeout), and `stop()` shows an alert with the manual command if `pmset` fails.

## Known gaps

- The `pmset` calls, the osascript dialog and the watchdog only ran by hand, never under test.
- `travel` (the shell script in the zprofile repo) and Keep Working don't know about each other: starting one
  doesn't stop the other's timer.
