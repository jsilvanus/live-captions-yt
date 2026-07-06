import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';

vi.mock('../../src/components/setup-hub/CameraSection.jsx', () => ({ CameraSection: () => <div data-testid="camera-section" /> }));
vi.mock('../../src/components/setup-hub/MixerSection.jsx', () => ({ MixerSection: () => <div data-testid="mixer-section" /> }));
vi.mock('../../src/components/setup-hub/EncoderSection.jsx', () => ({ EncoderSection: () => <div data-testid="encoder-section" /> }));
vi.mock('../../src/components/setup-hub/BridgeSection.jsx', () => ({ BridgeSection: () => <div data-testid="bridge-section" /> }));
vi.mock('../../src/components/setup-hub/EgressSection.jsx', () => ({ EgressSection: () => <div data-testid="egress-section" /> }));
vi.mock('../../src/components/setup-hub/IngestionSection.jsx', () => ({ IngestionSection: () => <div data-testid="ingestion-section" /> }));
vi.mock('../../src/components/setup-hub/WebRadioSection.jsx', () => ({ WebRadioSection: () => <div data-testid="webradio-section" /> }));
vi.mock('../../src/components/setup-hub/ViewportsSection.jsx', () => ({ ViewportsSection: () => <div data-testid="viewports-section" /> }));
vi.mock('../../src/components/setup-hub/CaptionTargetsSection.jsx', () => ({ CaptionTargetsSection: () => <div data-testid="caption-targets-section" /> }));
vi.mock('../../src/components/setup-hub/SttSection.jsx', () => ({ SttSection: () => <div data-testid="stt-section" /> }));
vi.mock('../../src/components/setup-hub/StorageSection.jsx', () => ({ StorageSection: () => <div data-testid="storage-section" /> }));
vi.mock('../../src/components/setup-hub/AiModelsSection.jsx', () => ({ AiModelsSection: () => <div data-testid="ai-models-section" /> }));
vi.mock('../../src/components/setup-hub/ConnectorsSection.jsx', () => ({ ConnectorsSection: () => <div data-testid="connectors-section" /> }));

import { SetupHubPage } from '../../src/components/setup-hub/SetupHubPage.jsx';

// SetupCard uses wouter's useRoute() (for /setup/:card deep links), which
// requires a Router context — wrap every render in one, at a given path.
function renderAt(path = '/setup') {
  const { hook } = memoryLocation({ path });
  return render(
    <Router hook={hook}>
      <SetupHubPage />
    </Router>
  );
}

describe('SetupHubPage', () => {
  it('renders every device/service section', () => {
    renderAt();
    expect(screen.getByTestId('camera-section')).toBeInTheDocument();
    expect(screen.getByTestId('mixer-section')).toBeInTheDocument();
    expect(screen.getByTestId('encoder-section')).toBeInTheDocument();
    expect(screen.getByTestId('bridge-section')).toBeInTheDocument();
    expect(screen.getByTestId('egress-section')).toBeInTheDocument();
    expect(screen.getByTestId('ingestion-section')).toBeInTheDocument();
    expect(screen.getByTestId('webradio-section')).toBeInTheDocument();
    expect(screen.getByTestId('viewports-section')).toBeInTheDocument();
    expect(screen.getByTestId('caption-targets-section')).toBeInTheDocument();
    expect(screen.getByTestId('stt-section')).toBeInTheDocument();
    expect(screen.getByTestId('storage-section')).toBeInTheDocument();
    expect(screen.getByTestId('ai-models-section')).toBeInTheDocument();
    expect(screen.getByTestId('connectors-section')).toBeInTheDocument();
  });

  it('links to the setup wizard as a secondary entry point', () => {
    renderAt();
    expect(screen.getByRole('link', { name: /run setup wizard/i })).toHaveAttribute('href', '/setup/wizard');
  });

  it('shows placeholder "Coming soon" cards for backend-less categories', () => {
    const { container } = renderAt();
    expect(screen.getByText('Workflows')).toBeInTheDocument();
    const placeholderCards = container.querySelectorAll('.setup-card--placeholder');
    expect(placeholderCards.length).toBeGreaterThanOrEqual(1);
  });

  it('flags client-only categories with a client-only status pill', () => {
    renderAt();
    expect(screen.getByText(/languages/i)).toBeInTheDocument();
    expect(screen.getAllByText('Client-only').length).toBeGreaterThanOrEqual(1);
  });

  it('scrolls the deep-linked card into view', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    renderAt('/setup/translations');
    expect(scrollIntoView).toHaveBeenCalled();
  });
});
