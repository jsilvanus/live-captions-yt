import React from 'react';
import { render } from '@testing-library/react';
import { AudioProvider } from '../src/contexts/AudioContext';

// Lightweight render helper that wraps UI with common providers
export function renderWithProviders(ui, options) {
  return render(<AudioProvider>{ui}</AudioProvider>, options);
}

// Re-export testing library helpers for convenience
export * from '@testing-library/react';
