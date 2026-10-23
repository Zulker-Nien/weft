# Keep Working

The menu bar icon's switch for keeping the Mac awake with the lid shut, so threads keep running in a bag.
macOS only (`createMenus` builds it when `mac` is true).

## Why `pmset`

Shutting the lid forces sleep whatever `caffeinate` or Electron's `powerSaveBlocker` say. Only
`pmset -a disablesleep 1` overrides it: no sleep, no hibernate, Wi-Fi stays up, jobs keep going. That needs root.

## Key files

- `electron/keep-working.cjs`: state, the sudoers install, the watchdog, and **Always while threads run** (`auto`, kept in
  `~/.weft/keep-working.json`: every 15 s, if a card is running and it's off, it starts "Until threads finish"; it never asks for
  the password from the background, and a hand-made Turn off pauses it until nothing runs). Takes `proc` (child_process) so
  tests pass fakes: `vi.mock` can't reach a `.cjs` require, and before this the tests ran the real `sudo pmset`.
- `electron/keep-working-prefs.cjs`: the settings file, `{ auto, minBattery, onlineOnly }` (floor one of 5/10/20/30/50, default 10);
  `cleanPrefs` drops unknown keys and values, so the IPC patch can't set odd ones. The watchdog gets the floor and the online flag
  as arguments (offline = no default route from `/sbin/route -n get default` for two 30 s checks); `setPrefs` respawns it when they
  change while on, and auto checks the same rules (`canHold`) before it starts, so it never starts only to stop.
- `electron/keep-working-menu.cjs`: the pure pieces the menu is built from (`trayTitle`, `statusText`, `menuTemplate`, `sudoersLine`).
- `components/LaptopModeCard.tsx`: Settings → Laptop mode, its own page (`lib/settings-nav.ts`), over `window.weft.keepWorking`
  (`electron/keep-working-ipc.cjs`, board window only).
- `electron/menus.cjs`: creates it (`menus.keepWorking`), puts `☕︎` and the hours left in the tray title next to the
  needs-you count, and adds the **Keep Working ▸** submenu above Open Weft.
- `electron/main.cjs`: calls `menus.keepWorking.stopSync()` on `will-quit`.
- `electron/keep-working.test.ts`: the pure pieces and the auto loop, against fake processes.

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
