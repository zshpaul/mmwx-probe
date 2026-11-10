export async function requestJson<T>(url: string, options: RequestInit = {}, timeoutMs = 10000): Promise<T> {
  const controller = new AbortController();
  const parent = options.signal;
  const cancel = () => controller.abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (parent?.aborted) throw new DOMException("Request aborted", "AbortError");
    parent?.addEventListener("abort", cancel, { once: true });
    timer = setTimeout(cancel, timeoutMs);
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json() as T;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    parent?.removeEventListener("abort", cancel);
  }
}
