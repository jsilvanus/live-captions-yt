import React from 'react';
import { render } from '@testing-library/react';

// Lightweight render helper kept intentionally minimal. Tests which require
// specific providers (SessionContext, CaptionContext, AudioProvider, etc.)
// should wrap their component under test explicitly to keep tests explicit
// about their required context.
export function renderWithProviders(ui, options) {
  return render(ui, options);
}

// Re-export testing library helpers for convenience
export * from '@testing-library/react';
