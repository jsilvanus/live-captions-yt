/**
 * Tests for AppProviders.
 *
 * BackendCaptionSender is mocked so no real HTTP traffic occurs.
 * Tests cover: smoke render, autoConnect behaviour, and embed BroadcastChannel.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { AppProviders } from '../../src/contexts/AppProviders.jsx';

// ---------------------------------------------------------------------------
// Mock BackendCaptionSender
// ---------------------------------------------------------------------------

const mockSender = {
  _token: 'mock-jwt-token',
  sequence: 0,
  syncOffset: 0,
  startedAt: new Date(),
  graphicsEnabled: false,
  apiKey: 'test-api-key',
  start: vi.fn().mockResolvedValue(undefined),
  end: vi.fn().mockResolvedValue(undefined),
  sync: vi.fn().mockResolvedValue({ syncOffset: 0 }),
  send: vi.fn().mockResolvedValue({ ok: true, requestId: 'req-1' }),
  sendBatch: vi.fn().mockResolvedValue({ ok: true, requestId: 'req-batch', count: 2 }),
  construct: vi.fn().mockReturnValue(undefined),
  heartbeat: vi.fn().mockResolvedValue({ ok: true }),
  updateSession: vi.fn().mockResolvedValue(undefined),
};

vi.mock('lcyt/backend', () => ({
  BackendCaptionSender: vi.fn(function () { return mockSender; }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_CONFIG = {
  backendUrl: 'http://backend.test',
  apiKey: 'test-api-key',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockSender._token = 'mock-jwt-token';
  mockSender.sequence = 0;
  mockSender.syncOffset = 0;
});

// ---------------------------------------------------------------------------
// Smoke test
// ---------------------------------------------------------------------------

describe('AppProviders — smoke test', () => {
  it('renders children without crashing', () => {
    render(
      <AppProviders>
        <div data-testid="child">Hello</div>
      </AppProviders>
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('renders children text content', () => {
    render(
      <AppProviders>
        <span>test content</span>
      </AppProviders>
    );
    expect(screen.getByText('test content')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// autoConnect
// ---------------------------------------------------------------------------

describe('AppProviders — autoConnect', () => {
  it('connects automatically when autoConnect=true and valid initConfig', async () => {
    await act(async () => {
      render(
        <AppProviders autoConnect initConfig={VALID_CONFIG}>
          <div>child</div>
        </AppProviders>
      );
    });
    expect(mockSender.start).toHaveBeenCalledTimes(1);
  });

  it('does not connect when autoConnect is not set', async () => {
    await act(async () => {
      render(
        <AppProviders initConfig={VALID_CONFIG}>
          <div>child</div>
        </AppProviders>
      );
    });
    expect(mockSender.start).not.toHaveBeenCalled();
  });

  it('does not connect when initConfig is missing backendUrl', async () => {
    await act(async () => {
      render(
        <AppProviders autoConnect initConfig={{ apiKey: 'test-key' }}>
          <div>child</div>
        </AppProviders>
      );
    });
    expect(mockSender.start).not.toHaveBeenCalled();
  });

  it('does not connect when initConfig is missing apiKey', async () => {
    await act(async () => {
      render(
        <AppProviders autoConnect initConfig={{ backendUrl: 'http://backend.test' }}>
          <div>child</div>
        </AppProviders>
      );
    });
    expect(mockSender.start).not.toHaveBeenCalled();
  });

  it('does not connect when initConfig is not provided', async () => {
    await act(async () => {
      render(
        <AppProviders autoConnect>
          <div>child</div>
        </AppProviders>
      );
    });
    expect(mockSender.start).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// embed mode
// ---------------------------------------------------------------------------

describe('AppProviders — embed mode', () => {
  // Capture the last BroadcastChannel instance created by the component.
  // The global stub (class FakeBroadcastChannel) is installed in setup.vitest.js.
  let lastChannel;

  beforeEach(() => {
    lastChannel = null;
    // Extend the stub to capture the latest instance
    global.BroadcastChannel = class FakeBroadcastChannel {
      constructor(name) {
        this._name = name;
        this.onmessage = null;
        this.postMessage = vi.fn();
        this.close = vi.fn();
        lastChannel = this;
      }
    };
  });

  it('opens a BroadcastChannel named "lcyt-embed" when embed=true', async () => {
    await act(async () => {
      render(
        <AppProviders embed>
          <div>child</div>
        </AppProviders>
      );
    });

    expect(lastChannel).not.toBeNull();
    expect(lastChannel._name).toBe('lcyt-embed');
  });

  it('does not open a BroadcastChannel when embed is not set', async () => {
    await act(async () => {
      render(
        <AppProviders>
          <div>child</div>
        </AppProviders>
      );
    });

    expect(lastChannel).toBeNull();
  });

  it('broadcasts lcyt:session after autoConnect + embed', async () => {
    await act(async () => {
      render(
        <AppProviders embed autoConnect initConfig={VALID_CONFIG}>
          <div>child</div>
        </AppProviders>
      );
    });

    expect(lastChannel.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'lcyt:session',
        token: 'mock-jwt-token',
        backendUrl: 'http://backend.test',
      })
    );
  });

  it('responds to lcyt:request_session after connect', async () => {
    await act(async () => {
      render(
        <AppProviders embed autoConnect initConfig={VALID_CONFIG}>
          <div>child</div>
        </AppProviders>
      );
    });

    lastChannel.postMessage.mockClear();

    // Simulate a late-joining sentlog requesting the session
    await act(async () => {
      lastChannel.onmessage({ data: { type: 'lcyt:request_session' } });
    });

    expect(lastChannel.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'lcyt:session',
        token: 'mock-jwt-token',
        backendUrl: 'http://backend.test',
      })
    );
  });
});
