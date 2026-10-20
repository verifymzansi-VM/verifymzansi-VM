/**
 * One page-wide holder for Chrome's install prompt. The banner and /install both
 * read it, so whichever is on screen can use the prompt, and an event fired
 * before React hydrated is kept by the inline capture script in the root layout.
 */

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export type InstallOutcome = "accepted" | "dismissed" | "unavailable" | "failed";

/** Global the inline layout script stores an early event on. */
export const EARLY_PROMPT_GLOBAL = "__vmInstallPrompt";

/** Inline <head> script: hold the event until the app's JS is ready. */
export const EARLY_INSTALL_PROMPT_CAPTURE = `window.addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.${EARLY_PROMPT_GLOBAL}=e;});window.addEventListener("appinstalled",function(){window.${EARLY_PROMPT_GLOBAL}=null;});`;

type State = { prompt: BeforeInstallPromptEvent | null; installed: boolean };

let state: State = { prompt: null, installed: false };
let started = false;
const listeners = new Set<() => void>();

function setState(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;

  const early = (window as unknown as Record<string, unknown>)[EARLY_PROMPT_GLOBAL];
  if (early instanceof Event) state = { ...state, prompt: early as BeforeInstallPromptEvent };

  window.addEventListener("beforeinstallprompt", (event) => {
    // Keep Chrome's own mini-infobar away; our banner and /install offer the button.
    event.preventDefault();
    setState({ prompt: event as BeforeInstallPromptEvent });
  });
  window.addEventListener("appinstalled", () => {
    setState({ prompt: null, installed: true });
  });
}

export function subscribeInstallPrompt(listener: () => void) {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getInstallPromptState(): State {
  return state;
}

const SERVER_STATE: State = { prompt: null, installed: false };

export function getServerInstallPromptState(): State {
  return SERVER_STATE;
}

export async function promptInstall(): Promise<InstallOutcome> {
  const { prompt } = state;
  if (!prompt) return "unavailable";
  try {
    await prompt.prompt();
    // Some browsers reject userChoice; keep the event so the button stays usable.
    const choice = await prompt.userChoice.catch(() => null);
    if (!choice) return "failed";
    // A prompt can only be shown once; Chrome fires a fresh event if it allows another.
    setState({ prompt: null });
    return choice.outcome;
  } catch {
    return "failed";
  }
}

/** Test-only: forget captured events between tests. */
export function resetInstallPromptStore() {
  state = { prompt: null, installed: false };
  if (typeof window !== "undefined") {
    (window as unknown as Record<string, unknown>)[EARLY_PROMPT_GLOBAL] = undefined;
  }
}
