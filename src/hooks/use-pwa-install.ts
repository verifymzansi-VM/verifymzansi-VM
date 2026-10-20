"use client";

import { useSyncExternalStore } from "react";
import { detectInstallEnvironment, type InstallEnvironment } from "@/lib/pwa/install-environment";
import {
  getInstallPromptState,
  getServerInstallPromptState,
  promptInstall,
  subscribeInstallPrompt,
} from "@/lib/pwa/install-prompt-store";

const STANDALONE_QUERY = "(display-mode: standalone)";

function subscribeDisplayMode(callback: () => void) {
  const mql = window.matchMedia(STANDALONE_QUERY);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function getEnvironmentSnapshot(): InstallEnvironment {
  return detectInstallEnvironment(navigator, window.matchMedia(STANDALONE_QUERY).matches);
}

function getServerSnapshot(): InstallEnvironment | null {
  return null;
}

const noopSubscribe = () => () => {};

/**
 * Install state shared by the install banner and the /install page.
 * `environment` is null during server render and when disabled.
 */
export function usePwaInstall(enabled = true) {
  const detected = useSyncExternalStore<InstallEnvironment | null>(
    enabled ? subscribeDisplayMode : noopSubscribe,
    enabled ? getEnvironmentSnapshot : getServerSnapshot,
    getServerSnapshot
  );
  const { prompt, installed } = useSyncExternalStore(
    subscribeInstallPrompt,
    getInstallPromptState,
    getServerInstallPromptState
  );

  return {
    environment: enabled && installed ? ("installed" as const) : detected,
    canPrompt: enabled && prompt !== null,
    promptInstall,
  };
}
