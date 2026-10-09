// Remembers a window's size and position between launches, and keeps it on a screen that exists.
const { app, screen } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

function file(name) {
  return path.join(app.getPath("userData"), `${name}-window.json`);
}

function onScreen(bounds) {
  return screen.getAllDisplays().some(({ workArea: a }) => {
    const overlapX = Math.min(bounds.x + bounds.width, a.x + a.width) - Math.max(bounds.x, a.x);
    const overlapY = Math.min(bounds.y + bounds.height, a.y + a.height) - Math.max(bounds.y, a.y);
    return overlapX > 120 && overlapY > 80;
  });
}

// Returns saved { x, y, width, height, maximized } or the defaults.
function loadWindowState(name, defaults) {
  try {
    const saved = JSON.parse(fs.readFileSync(file(name), "utf8"));
    if (saved.width > 200 && saved.height > 200 && onScreen(saved)) return { ...defaults, ...saved };
  } catch {}
  return defaults;
}

// Saves the window's bounds whenever it moves or resizes (debounced) and when it closes.
function trackWindowState(name, win) {
  let timer;
  const save = () => {
    clearTimeout(timer);
    if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
    const state = { ...(win.isMaximized() ? {} : win.getBounds()), maximized: win.isMaximized() };
    try {
      const previous = JSON.parse(fs.readFileSync(file(name), "utf8"));
      fs.writeFileSync(file(name), JSON.stringify({ ...previous, ...state }));
    } catch {
      fs.writeFileSync(file(name), JSON.stringify(state));
    }
  };
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(save, 400);
  };
  win.on("resize", later);
  win.on("move", later);
  win.on("close", save);
}

module.exports = { loadWindowState, trackWindowState };
