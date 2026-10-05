import { useLayoutEffect, useRef } from "react";
import shellHtml from "../../gev/shell.html?raw";
import {
  attachPersistentGlobeHost,
  parkPersistentGlobeHost,
  startGlobeBoot,
} from "../../gev/src/bootCache.js";

declare global {
  interface Window {
    CESIUM_BASE_URL?: string;
  }
}

export function GodsEyeView() {
  const slotRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const slot = slotRef.current;
    if (!slot) return;

    attachPersistentGlobeHost(slot, shellHtml);
    void startGlobeBoot({
      loadMain: () => import("../../gev/src/main.js"),
    }).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error("God's Eye View failed to start:", err);
      const status = document.querySelector(".loader-status");
      if (status instanceof HTMLElement) {
        status.textContent = `Error: ${message}`;
        status.style.color = "#ff4444";
      }
    });
    return () => {
      parkPersistentGlobeHost();
    };
  }, []);

  return (
    <div
      id="gev-mount"
      ref={slotRef}
      className="gev-root"
      suppressHydrationWarning
    />
  );
}
