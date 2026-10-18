/**
 * Webhook output: POST a JSON body when the state changes.
 *   { lightId, name, kind, state, detail, checkedAt }
 * Repeated readings of the same state are not sent again.
 */
export function createWebhookOutput({
  url,
  headers = {},
  lightId,
  name,
  fetch: fetchImpl = globalThis.fetch,
  timeoutMs = 5000,
  onError = () => {},
} = {}) {
  if (!url) throw new TypeError('url is required');
  let lastState = null;
  return {
    name: `webhook:${new URL(url).host}`,
    async apply(reading, ctx) {
      if (reading.state === lastState) return;
      lastState = reading.state;
      try {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify({ lightId, name, kind: ctx.kind, state: reading.state, detail: reading.detail ?? null, checkedAt: reading.checkedAt }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) throw new Error(`webhook answered ${res.status}`);
      } catch (err) {
        lastState = null; // try again on the next reading
        onError(err);
      }
    },
  };
}
