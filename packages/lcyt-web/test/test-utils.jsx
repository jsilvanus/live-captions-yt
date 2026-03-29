import React from 'react';
import { render } from '@testing-library/react';
import { AppProviders } from '../../src/contexts/AppProviders.jsx';

// Lightweight render helper kept intentionally minimal. Tests which require
// specific providers (SessionContext, CaptionContext, AudioProvider, etc.)
// should wrap their component under test explicitly to keep tests explicit
// about their required context. When a full app-level composition is needed
// use `renderWithAppProviders` below.
export function renderWithProviders(ui, options) {
  return render(ui, options);
}

export function renderWithAppProviders(ui, options) {
  return render(<AppProviders>{ui}</AppProviders>, options);
}

// Re-export testing library helpers for convenience
export * from '@testing-library/react';
