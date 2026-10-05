declare module "../../gev/src/main.js" {
  export function init(): Promise<void>;
}

declare module "../../gev/src/bootDebugBar.js" {
  export function mountBootDebugBar(host?: HTMLElement | null): HTMLElement | null;
  export function reportBootPhase(
    id: string,
    label: string,
    detailOrOptions?: string | { detail?: string; status?: string; probe?: Record<string, unknown> },
  ): void;
  export function completeBootPhase(
    id: string,
    options?: { status?: string; detail?: string; probe?: Record<string, unknown> },
  ): void;
  export function reportBootError(
    message: string,
    options?: { detail?: string; source?: string },
  ): void;
  export function completeBoot(options?: { detail?: string; degraded?: boolean }): void;
}

declare module "../../gev/src/bootCache.js" {
  export function attachPersistentGlobeHost(
    slot: HTMLElement | null,
    shellHtml: string,
  ): HTMLElement | null;
  export function parkPersistentGlobeHost(): void;
  export function startGlobeBoot(options: {
    loadMain: () => Promise<{ init: () => Promise<void> }>;
  }): Promise<void>;
  export function getBootCache(): {
    host: HTMLElement | null;
    enginePromise: Promise<unknown> | null;
    bootPromise: Promise<unknown> | null;
    initPromise: Promise<unknown> | null;
    engineReady: boolean;
  };
}

declare module "*.html?raw" {
  const html: string;
  export default html;
}
