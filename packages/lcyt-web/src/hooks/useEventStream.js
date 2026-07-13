import { useCallback, useEffect } from 'react';

const STREAM_TOPICS = [
  'variable.*',
  'role.*',
  'cue.fired',
  'dsk.*',
  'caption.*',
  'session.*',
  'plugin.*',
].join(',');

const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000];

const stream = {
  es: null,
  key: '',
  refs: 0,
  retryIndex: 0,
  retryTimer: null,
  desired: null,
  handlers: new Set(),
  controlHandlers: new Map(),
};

function topicMatches(patterns, topic) {
  if (!patterns || patterns.length === 0) return true;
  for (const p of patterns) {
    if (p === '*' || p === topic) return true;
    if (p.endsWith('.*')) {
      const prefix = p.slice(0, -2);
      if (topic.startsWith(`${prefix}.`)) return true;
    }
  }
  return false;
}

function closeStream() {
  if (stream.es) stream.es.close();
  stream.es = null;
}

function clearRetry() {
  if (stream.retryTimer) clearTimeout(stream.retryTimer);
  stream.retryTimer = null;
}

function dispatchEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object' || typeof envelope.topic !== 'string') return;
  for (const sub of stream.handlers) {
    if (!topicMatches(sub.patterns, envelope.topic)) continue;
    try { sub.handler(envelope); } catch {}
  }
}

function dispatchControl(name, data) {
  const handlers = stream.controlHandlers.get(name);
  if (!handlers) return;
  for (const handler of handlers) {
    try { handler(data); } catch {}
  }
}

function scheduleReconnect() {
  if (!stream.desired || stream.retryTimer || stream.refs < 1) return;
  const delay = RETRY_DELAYS_MS[Math.min(stream.retryIndex, RETRY_DELAYS_MS.length - 1)];
  stream.retryTimer = setTimeout(() => {
    stream.retryTimer = null;
    stream.retryIndex = Math.min(stream.retryIndex + 1, RETRY_DELAYS_MS.length - 1);
    ensureConnected();
  }, delay);
}

function buildUrl({ backendUrl, token }) {
  if (!backendUrl || !token) return null;
  const qs = new URLSearchParams({
    token,
    flat: '1',
    topics: STREAM_TOPICS,
  });
  return `${backendUrl}/events/stream?${qs}`;
}

function ensureConnected() {
  if (!stream.desired || stream.refs < 1) return;
  if (!stream.desired.token) return;
  const nextKey = `${stream.desired.backendUrl}::${stream.desired.token}`;
  if (stream.es && stream.key === nextKey) return;

  clearRetry();
  closeStream();
  stream.key = nextKey;

  const url = buildUrl(stream.desired);
  if (!url) return;
  const es = new EventSource(url);
  stream.es = es;

  es.onopen = () => {
    stream.retryIndex = 0;
  };

  es.addEventListener('connected', (evt) => {
    try {
      dispatchControl('connected', JSON.parse(evt.data));
    } catch {
      dispatchControl('connected', null);
    }
  });

  es.onmessage = (evt) => {
    try {
      const envelope = JSON.parse(evt.data);
      dispatchEnvelope(envelope);
    } catch {}
  };

  es.onerror = () => {
    if (stream.es !== es) return;
    closeStream();
    scheduleReconnect();
  };
}

function retainConnection(desired) {
  stream.refs += 1;
  stream.desired = desired;
  ensureConnected();
}

function releaseConnection() {
  stream.refs = Math.max(0, stream.refs - 1);
  if (stream.refs > 0) return;
  stream.desired = null;
  clearRetry();
  closeStream();
  stream.key = '';
  stream.retryIndex = 0;
}

export function useEventStream({ backendUrl, connected, getToken }) {
  useEffect(() => {
    if (!connected || !backendUrl) return undefined;
    const token = getToken?.();
    if (!token) return undefined;
    retainConnection({ backendUrl, token });
    return () => releaseConnection();
  }, [backendUrl, connected, getToken]);

  const on = useCallback((topicPattern, handler) => {
    if (typeof handler !== 'function') return () => {};
    const patterns = Array.isArray(topicPattern)
      ? topicPattern.filter(Boolean)
      : (typeof topicPattern === 'string' && topicPattern ? [topicPattern] : null);
    const sub = { patterns, handler };
    stream.handlers.add(sub);
    return () => {
      stream.handlers.delete(sub);
    };
  }, []);

  const onControl = useCallback((eventName, handler) => {
    if (!eventName || typeof handler !== 'function') return () => {};
    if (!stream.controlHandlers.has(eventName)) stream.controlHandlers.set(eventName, new Set());
    const set = stream.controlHandlers.get(eventName);
    set.add(handler);
    return () => {
      set.delete(handler);
      if (set.size === 0) stream.controlHandlers.delete(eventName);
    };
  }, []);

  return { on, onControl };
}
