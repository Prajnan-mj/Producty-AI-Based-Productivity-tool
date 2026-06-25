/**
 * Stream a chat completion from POST /ai/chat over Server-Sent Events.
 *
 * The backend chat endpoint is an authenticated POST that returns
 * `text/event-stream`. The native EventSource API only supports GET and can't
 * attach the JWT header, so we use fetch + a ReadableStream reader to parse the
 * SSE frames ourselves.
 *
 * @param {Object}   opts
 * @param {string}   opts.message         The new user message.
 * @param {Array}    opts.contextWindow   Prior [{role, content}] turns.
 * @param {Function} opts.onToken         Called with each streamed text chunk.
 * @param {Function} opts.onDone          Called once the stream finishes.
 * @param {Function} opts.onError         Called with an Error on failure.
 * @param {AbortSignal} [opts.signal]     Optional abort signal.
 */
export async function streamChat({ message, contextWindow = [], onToken, onDone, onError, signal }) {
  const base = import.meta.env.VITE_API_URL || "/api";
  const token = localStorage.getItem("token");

  try {
    const res = await fetch(`${base}/ai/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ message, context_window: contextWindow }),
      signal,
    });

    if (!res.ok || !res.body) {
      onError?.(new Error(`Chat request failed (${res.status})`));
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() || ""; // keep incomplete frame

      for (const frame of frames) {
        const line = frame.trim();
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();

        if (data === "[DONE]") {
          onDone?.();
          return;
        }
        try {
          const parsed = JSON.parse(data);
          if (parsed.content) onToken?.(parsed.content);
          else if (parsed.error) onError?.(new Error(parsed.error));
        } catch {
          /* ignore malformed frame */
        }
      }
    }
    onDone?.();
  } catch (err) {
    if (err.name !== "AbortError") onError?.(err);
  }
}
