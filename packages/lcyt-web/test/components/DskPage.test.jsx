/**
 * Tests for DskPage exit-animation behaviour.
 *
 * EventSource is stubbed globally in test/setup.vitest.js, but that stub doesn't let
 * tests dispatch events. We install a local fake EventSource here that records its
 * listeners so the test can fire 'graphics' events the way the real SSE stream would.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { DskPage } from '../../src/components/DskPage.jsx';

const IMAGE = {
  id: 1,
  shorthand: 'logo',
  mimeType: 'image/png',
  settingsJson: {
    viewports: {
      landscape: { animation: 'lcyt-fadeIn 0.2s ease 0s 1 normal forwards' },
    },
  },
};

let esInstances;

class FakeEventSource {
  constructor(url) {
    this.url = url;
    this.listeners = {};
    this.close = vi.fn();
    esInstances.push(this);
  }
  addEventListener(type, handler) {
    (this.listeners[type] ||= []).push(handler);
  }
  removeEventListener() {}
  emit(type, data) {
    for (const handler of this.listeners[type] || []) {
      handler({ data: JSON.stringify(data) });
    }
  }
}

beforeEach(() => {
  esInstances = [];
  global.EventSource = FakeEventSource;
  global.fetch = vi.fn((url) => {
    if (String(url).includes('/images')) {
      return Promise.resolve({ ok: true, json: async () => ({ images: [IMAGE] }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
  window.history.pushState({}, '', '/dsk/testkey?viewport=landscape');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function activeImg(container) {
  return container.querySelector('img[aria-hidden="true"]');
}

describe('DskPage — exit animation', () => {
  it('keeps an exiting image mounted with the derived exit animation, then removes it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { container } = render(<DskPage />);

    await waitFor(() => expect(esInstances.length).toBe(1));
    const es = esInstances[0];

    act(() => {
      es.emit('graphics', { default: ['logo'], viewports: {}, ts: Date.now() });
    });

    await waitFor(() => expect(activeImg(container)).not.toBeNull());
    expect(activeImg(container).style.animation).toContain('lcyt-fadeIn');

    act(() => {
      es.emit('graphics', { default: [], viewports: {}, ts: Date.now() });
    });

    // Still mounted right after removal, now playing the derived exit animation.
    await waitFor(() => {
      const img = activeImg(container);
      expect(img).not.toBeNull();
      expect(img.style.animation).toContain('lcyt-fadeOut');
    });

    // Once the animation's total duration has elapsed, the element is removed.
    act(() => {
      vi.advanceTimersByTime(250);
    });
    await waitFor(() => expect(activeImg(container)).toBeNull());
  });

  it('reads slug + viewport from the path form /dsk/:slug/:viewport', async () => {
    const vpImage = {
      id: 3, shorthand: 'logo', mimeType: 'image/png',
      settingsJson: { viewports: { 'vertical-left': { animation: '' } } },
    };
    global.fetch = vi.fn((url) => {
      if (String(url).includes('/images')) {
        return Promise.resolve({ ok: true, json: async () => ({ images: [vpImage] }) });
      }
      if (String(url).includes('/viewports/public')) {
        return Promise.resolve({ ok: true, json: async () => ({ projectSlug: 'sunday', viewports: [
          { name: 'vertical-left', viewportType: 'vertical', width: 1080, height: 1920, textLayers: [] },
        ] }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    window.history.pushState({}, '', '/dsk/sunday/vertical-left');

    const { container } = render(<DskPage />);
    await waitFor(() => expect(esInstances.length).toBe(1));

    // SSE opened against the slug path segment, not a raw key.
    expect(esInstances[0].url).toContain('/dsk/sunday/events');

    // A graphics event scoped to the path-derived viewport activates the image,
    // proving the viewport name came from pathParts[3].
    act(() => {
      esInstances[0].emit('graphics', { default: [], viewports: { 'vertical-left': ['logo'] }, ts: Date.now() });
    });
    await waitFor(() => expect(activeImg(container)).not.toBeNull());
  });

  it('removes an image instantly when it has no configured animation', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    global.fetch = vi.fn((url) => {
      if (String(url).includes('/images')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ images: [{ id: 2, shorthand: 'plain', mimeType: 'image/png', settingsJson: { viewports: { landscape: {} } } }] }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const { container } = render(<DskPage />);
    await waitFor(() => expect(esInstances.length).toBe(1));
    const es = esInstances[0];

    act(() => {
      es.emit('graphics', { default: ['plain'], viewports: {}, ts: Date.now() });
    });
    await waitFor(() => expect(activeImg(container)).not.toBeNull());

    act(() => {
      es.emit('graphics', { default: [], viewports: {}, ts: Date.now() });
    });
    await waitFor(() => expect(activeImg(container)).toBeNull());
  });
});
