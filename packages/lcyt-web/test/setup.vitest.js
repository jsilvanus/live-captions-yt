import '@testing-library/jest-dom';
import { vi, beforeEach } from 'vitest';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

// Stub EventSource — jsdom does not implement it
global.EventSource = vi.fn(function () {
  this.addEventListener = vi.fn();
  this.removeEventListener = vi.fn();
  this.close = vi.fn();
  this.readyState = 1;
});

// Stub BroadcastChannel — jsdom does not implement it
global.BroadcastChannel = class FakeBroadcastChannel {
  constructor() {
    this.onmessage = null;
    this.postMessage = vi.fn();
    this.close = vi.fn();
  }
};
