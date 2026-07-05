import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../src/components/setup-hub/CameraSection.jsx', () => ({ CameraSection: () => <div data-testid="camera-section" /> }));
vi.mock('../../src/components/setup-hub/MixerSection.jsx', () => ({ MixerSection: () => <div data-testid="mixer-section" /> }));
vi.mock('../../src/components/setup-hub/EncoderSection.jsx', () => ({ EncoderSection: () => <div data-testid="encoder-section" /> }));
vi.mock('../../src/components/setup-hub/BridgeSection.jsx', () => ({ BridgeSection: () => <div data-testid="bridge-section" /> }));
vi.mock('../../src/components/setup-hub/SttSection.jsx', () => ({ SttSection: () => <div data-testid="stt-section" /> }));
vi.mock('../../src/components/setup-hub/StorageSection.jsx', () => ({ StorageSection: () => <div data-testid="storage-section" /> }));
vi.mock('../../src/components/setup-hub/AiModelsSection.jsx', () => ({ AiModelsSection: () => <div data-testid="ai-models-section" /> }));

import { SetupHubPage } from '../../src/components/setup-hub/SetupHubPage.jsx';

describe('SetupHubPage', () => {
  it('renders every device/service section', () => {
    render(<SetupHubPage />);
    expect(screen.getByTestId('camera-section')).toBeInTheDocument();
    expect(screen.getByTestId('mixer-section')).toBeInTheDocument();
    expect(screen.getByTestId('encoder-section')).toBeInTheDocument();
    expect(screen.getByTestId('bridge-section')).toBeInTheDocument();
    expect(screen.getByTestId('stt-section')).toBeInTheDocument();
    expect(screen.getByTestId('storage-section')).toBeInTheDocument();
    expect(screen.getByTestId('ai-models-section')).toBeInTheDocument();
  });

  it('links to the setup wizard as a secondary entry point', () => {
    render(<SetupHubPage />);
    expect(screen.getByRole('link', { name: /run setup wizard/i })).toHaveAttribute('href', '/setup/wizard');
  });

  it('shows disabled "Coming soon" cards for backend-less categories', () => {
    const { container } = render(<SetupHubPage />);
    expect(screen.getByText('API connectors')).toBeInTheDocument();
    expect(screen.getByText('Workflows')).toBeInTheDocument();
    const disabledCards = container.querySelectorAll('.setup-card--disabled');
    expect(disabledCards.length).toBeGreaterThanOrEqual(2);
  });

  it('flags client-only categories with a client-only status pill', () => {
    render(<SetupHubPage />);
    expect(screen.getByText('Caption targets')).toBeInTheDocument();
    expect(screen.getByText(/languages/i)).toBeInTheDocument();
    expect(screen.getAllByText('Client-only').length).toBeGreaterThanOrEqual(2);
  });
});
