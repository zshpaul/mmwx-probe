import { requestJson } from "./request-json";

function check(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
const anyDescriptor = Object.getOwnPropertyDescriptor(AbortSignal, "any");
const timeoutDescriptor = Object.getOwnPropertyDescriptor(AbortSignal, "timeout");
const timers = new Map<number, () => void>();
let nextTimer = 0;

async function rejected(promise: Promise<unknown>, message: string) {
  let failed = false;
  try { await promise; } catch { failed = true; }
  check(failed, message);
  check(timers.size === 0, "Every failed request must clear its timer");
}

async function verify() {
  try {
    Object.defineProperty(AbortSignal, "any", { configurable: true, value: undefined });
    Object.defineProperty(AbortSignal, "timeout", { configurable: true, value: undefined });
    globalThis.setTimeout = ((callback: () => void) => {
      const identifier = ++nextTimer;
      timers.set(identifier, callback);
      return identifier;
    }) as typeof setTimeout;
    globalThis.clearTimeout = ((identifier: number) => { timers.delete(identifier); }) as typeof clearTimeout;
    const parent = new AbortController();
    let receivedSignal: AbortSignal | null | undefined;
    globalThis.fetch = (async (_url, options) => {
      receivedSignal = options?.signal;
      return Response.json({ value: 42 });
    }) as typeof fetch;
    const body = await requestJson<{ value: number }>("/api/probe", { signal: parent.signal });
    check(body.value === 42 && timers.size === 0, "Success without AbortSignal.any/timeout and no leaked timer");
    parent.abort();
    check(!receivedSignal?.aborted, "Parent listener must be removed after success");

    globalThis.fetch = (() => { throw new Error("Synchronous fetch failure"); }) as typeof fetch;
    let promise: Promise<unknown> | undefined;
    try { promise = requestJson("/api/visitor"); } catch { throw new Error("Synchronous fetch failure escaped the promise"); }
    await rejected(promise, "Synchronous failures must reach consumer catch");

    globalThis.fetch = (async () => new Response("", { status: 503 })) as typeof fetch;
    await rejected(requestJson("/api/visitor"), "HTTP failures reject");
    globalThis.fetch = (async () => new Response("invalid json")) as typeof fetch;
    await rejected(requestJson("/api/visitor"), "Invalid JSON rejects");

    const cancelled = new AbortController();
    cancelled.abort();
    let fetched = false;
    globalThis.fetch = (async () => { fetched = true; return Response.json({}); }) as typeof fetch;
    await rejected(requestJson("/api/probe", { signal: cancelled.signal }), "Pre-aborted requests reject");
    check(!fetched, "Pre-aborted requests must not fetch");

    const pendingFetch = (() => {
      globalThis.fetch = ((_url, options) => new Promise((_resolve, reject) => {
        receivedSignal = options?.signal;
        options?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      })) as typeof fetch;
    });
    pendingFetch();
    const unmount = new AbortController();
    const pending = requestJson("/api/series", { signal: unmount.signal });
    unmount.abort();
    await rejected(pending, "Parent cancellation must cancel network request");
    check(receivedSignal?.aborted, "Merged request signal was aborted");

    pendingFetch();
    const timedOut = requestJson("/api/visitor");
    for (const callback of timers.values()) callback();
    await rejected(timedOut, "Manual timeout must cancel request");

    let readingBody = false;
    globalThis.fetch = (async (_url, options) => ({
      ok: true,
      json: () => new Promise((_resolve, reject) => {
        readingBody = true;
        options?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      }),
    } as Response)) as typeof fetch;
    const stalledBody = requestJson("/api/visitor");
    await Promise.resolve();
    check(readingBody && timers.size === 1, "Timeout remains armed while JSON body is pending");
    for (const callback of timers.values()) callback();
    await rejected(stalledBody, "Timeout must also cover body read");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    if (anyDescriptor) Object.defineProperty(AbortSignal, "any", anyDescriptor);
    if (timeoutDescriptor) Object.defineProperty(AbortSignal, "timeout", timeoutDescriptor);
  }
}
void verify().catch(error => { originalSetTimeout(() => { throw error; }, 0); });
