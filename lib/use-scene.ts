"use client";

// The board's current scene (one of Weft's pictures behind the board), watched through a
// MutationObserver so a pick in Appearance while Settings is open is reflected right away.
import { useEffect, useState } from "react";
import { settingsScene, type SettingsPage } from "./settings-nav";
import type { Base, Scene } from "./theme";

export function currentSceneFromDOM(): Scene {
  const root = document.documentElement;
  return settingsScene(root.dataset.scene ?? "", root.dataset.theme === "dark" ? "dark" : "light");
}

export function useScene(): Scene {
  const [scene, setScene] = useState(currentSceneFromDOM);
  useEffect(() => {
    const watch = new MutationObserver(() => setScene(currentSceneFromDOM()));
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-scene", "data-theme"] });
    return () => watch.disconnect();
  }, []);
  return scene;
}

// re-export so consumers don't need both files.
export type { SettingsPage };
export type { Base, Scene };