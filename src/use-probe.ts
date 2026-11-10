import { useEffect, useState } from "react";
import type { ProbeAppearance, ProbePayload, ThemeName } from "./types";
import { normalizeColorMode, type ProbeColorMode } from "./theme-preference";

const APPEARANCE_CACHE = "mmwx-probe-appearance";
const COLOR_MODE_PREFERENCE = "mmwx-probe-color-mode";

function normalizeTheme(value?: string): ThemeName {
  const theme = value?.trim();
  return theme && /^[A-Za-z0-9_-]{1,64}$/.test(theme) ? theme : "pixel";
}

export function applyAppearance(input?: ProbeAppearance, override?: ProbeColorMode) {
  const cached = (() => {
    try {
      return JSON.parse(
        localStorage.getItem(APPEARANCE_CACHE) || "null",
      ) as ProbeAppearance | null;
    } catch {
      return null;
    }
  })();
  const appearance = input || cached || { theme: "pixel", color_mode: "light" };
  const theme = normalizeTheme(appearance.theme);
  const colorMode = override ?? readColorModePreference(appearance.color_mode);
  const root = document.documentElement;
  for (const className of Array.from(root.classList)) {
    if (className.startsWith("theme-")) root.classList.remove(className);
  }
  root.classList.remove("light", "dark");
  root.classList.add(`theme-${theme}`);
  const dark =
    colorMode === "dark" ||
    (colorMode === "system" &&
      matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.add(dark ? "dark" : "light");
  root.style.colorScheme = dark ? "dark" : "light";
  root.dataset.themeReady = "true";
  if (input) {
    try {
      localStorage.setItem(APPEARANCE_CACHE, JSON.stringify(input));
    } catch {
      // Theme switching must keep working when storage is blocked.
    }
  }
}

export function readColorModePreference(
  fallback?: ProbeAppearance["color_mode"],
): ProbeColorMode {
  try {
    return normalizeColorMode(
      localStorage.getItem(COLOR_MODE_PREFERENCE),
      normalizeColorMode(fallback),
    );
  } catch {
    return normalizeColorMode(fallback);
  }
}

export function saveColorModePreference(mode: ProbeColorMode) {
  try {
    localStorage.setItem(COLOR_MODE_PREFERENCE, mode);
  } catch {
    // Applying the selected mode for the current page still succeeds.
  }
}

export function useProbe(): { data?: ProbePayload; error?: string; connection: "live" | "polling"; updatedAt?: number } {
  const [data, setData] = useState<ProbePayload>();
  const [error, setError] = useState<string>();
  const [connection, setConnection] = useState<"live" | "polling">("polling");
  const [updatedAt, setUpdatedAt] = useState<number>();

  useEffect(() => {
    let stopped = false;
    let ws: WebSocket | undefined;
    let reconnectTimer: number | undefined;
    let lastFrame = 0;
    let openedAt = 0;
    let retries = 0;
    let pending = false;
    const controller = new AbortController();
    const accept = (payload: ProbePayload) => {
      if (stopped) return;
      if (!payload || typeof payload.enabled !== "boolean") throw new Error("探针响应格式无效");
      applyAppearance(payload.appearance);
      setData(payload);
      setError(undefined);
      setUpdatedAt(Date.now());
      document.title = "MMWX Probe";
    };
    const poll = async () => {
      if (stopped || pending || (lastFrame && Date.now() - lastFrame < 12000)) return;
      pending = true;
      const startedAt = Date.now();
      try {
        const response = await fetch("/api/probe", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = (await response.json()) as ProbePayload;
        if (lastFrame <= startedAt) {
          accept(payload);
          if (!stopped) setConnection("polling");
        }
      } catch (cause) {
        if (!stopped && lastFrame <= startedAt)
          setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        pending = false;
      }
    };
    const reconnect = () => {
      if (stopped) return;
      lastFrame = 0;
      setConnection("polling");
      void poll();
      if (reconnectTimer !== undefined) return;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = undefined;
        connect();
      }, Math.min(30000, 1000 * 2 ** Math.min(retries++, 5)));
    };
    const connect = () => {
      if (stopped) return;
      try {
        const protocol = location.protocol === "https:" ? "wss:" : "ws:";
        const socket = new WebSocket(`${protocol}//${location.host}/api/stream`);
        ws = socket;
        openedAt = Date.now();
        socket.onmessage = (event) => {
          if (stopped || socket !== ws) return;
          try {
            accept(JSON.parse(event.data) as ProbePayload);
            lastFrame = Date.now();
            retries = 0;
            setConnection("live");
          } catch {}
        };
        socket.onerror = () => socket.close();
        socket.onclose = reconnect;
      } catch { reconnect(); }
    };
    applyAppearance();
    document.title = "MMWX Probe";
    void poll();
    connect();
    const timer = window.setInterval(() => {
      if (ws && Date.now() - (lastFrame || openedAt) > 15000) ws.close();
      void poll();
    }, 5000);
    return () => {
      stopped = true;
      controller.abort();
      window.clearInterval(timer);
      window.clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);

  return { data, error, connection, updatedAt };
}
