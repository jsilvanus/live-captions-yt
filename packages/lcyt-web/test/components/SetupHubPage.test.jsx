import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { SessionContext } from '../../src/contexts/SessionContext.jsx';

vi.mock('../../src/components/setup-hub/CameraSection.jsx', () => ({ CameraSection: () => <div data-testid="camera-section" /> }));
vi.mock('../../src/components/setup-hub/MixerSection.jsx', () => ({ MixerSection: () => <div data-testid="mixer-section" /> }));
vi.mock('../../src/components/setup-hub/EncoderSection.jsx', () => ({ EncoderSection: () => <div data-testid="encoder-section" /> }));
vi.mock('../../src/components/setup-hub/BridgeSection.jsx', () => ({ BridgeSection: () => <div data-testid="bridge-section" /> }));
vi.mock('../../src/components/setup-hub/EgressSection.jsx', () => ({ EgressSection: () => <div data-testid="egress-section" /> }));
vi.mock('../../src/components/setup-hub/IngestionSection.jsx', () => ({ IngestionSection: () => <div data-testid="ingestion-section" /> }));
vi.mock('../../src/components/setup-hub/WebRadioSection.jsx', () => ({ WebRadioSection: () => <div data-testid="webradio-section" /> }));
vi.mock('../../src/components/setup-hub/ViewportsSection.jsx', () => ({ ViewportsSection: () => <div data-testid="viewports-section" /> }));
vi.mock('../../src/components/setup-hub/CaptionTargetsSection.jsx', () => ({ CaptionTargetsSection: () => <div data-testid="caption-targets-section" /> }));
vi.mock('../../src/components/setup-hub/LanguagesSection.jsx', () => ({ LanguagesSection: () => <div data-testid="languages-section" /> }));
vi.mock('../../src/components/setup-hub/SttSection.jsx', () => ({ SttSection: () => <div data-testid="stt-section" /> }));
vi.mock('../../src/components/setup-hub/StorageSection.jsx', () => ({ StorageSection: () => <div data-testid="storage-section" /> }));
vi.mock('../../src/components/setup-hub/McpAccessSection.jsx', () => ({ McpAccessSection: () => <div data-testid="mcp-access-section" /> }));
vi.mock('../../src/components/setup-hub/ConnectorsSection.jsx', () => ({ ConnectorsSection: () => <div data-testid="connectors-section" /> }));
vi.mock('../../src/components/setup-hub/AiRoleModelsSection.jsx', () => ({ AiRoleModelsSection: () => <div data-testid="ai-role-models-section" /> }));

import { SetupHubPage } from '../../src/components/setup-hub/SetupHubPage.jsx';

// SetupCard uses wouter's useRoute() (for /setup/:card deep links), which
// requires a Router context. SetupHubPage itself calls useSessionContext()
// (for the Workflow filter's feature lookup), which throws without a
// SessionContext.Provider — a disconnected mock is enough since
// useProjectFeatures() no-ops without a real apiKey/token/backendUrl.
const mockSession = { connected: false, apiKey: '', backendUrl: '', getSessionToken: () => null, getPersistedConfig: () => ({}) };

function renderAt(path = '/setup') {
  const { hook } = memoryLocation({ path });
  return render(
    <SessionContext.Provider value={mockSession}>
      <Router hook={hook}>
        <SetupHubPage />
      </Router>
    </SessionContext.Provider>
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
    expect(screen.getByTestId('mcp-access-section')).toBeInTheDocument();
    expect(screen.getByTestId('connectors-section')).toBeInTheDocument();
    expect(screen.getByTestId('languages-section')).toBeInTheDocument();
    expect(screen.getByTestId('ai-role-models-section')).toBeInTheDocument();
  });

  it('links to the setup wizard as a secondary entry point', () => {
    renderAt();
    expect(screen.getByRole('link', { name: /run setup wizard/i })).toHaveAttribute('href', '/setup/wizard');
  });

  it('renders the Workflows card as a CTA, not a disabled placeholder', () => {
    const { container } = renderAt();
    expect(screen.getByText('Workflows')).toBeInTheDocument();
    expect(container.querySelectorAll('.setup-card--placeholder')).toHaveLength(0);
    expect(container.querySelectorAll('.setup-card--cta')).toHaveLength(1);
  });

  it('renders the All/Favorites/Workflow filter pills, "All" active by default', () => {
    renderAt();
    const all = screen.getByRole('button', { name: 'All' });
    expect(all).toHaveClass('setup-hub-page__pill--active');
    expect(screen.getByRole('button', { name: 'Favorites' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Workflow' })).toBeInTheDocument();
  });

  it('"Favorites" filter hides sections that are not starred, but always keeps Workflows', () => {
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: 'Favorites' }));
    expect(screen.queryByTestId('camera-section')).not.toBeInTheDocument();
    expect(screen.getByText('Workflows')).toBeInTheDocument();
  });

  it('scrolls the deep-linked card into view', () => {
    // Workflows is the only remaining un-mocked inline SetupCard (a real
    // `id`-bearing instance, needed since the highlight/scroll behavior is
    // per-SetupCard via its own useRoute() check) — every other section is
    // mocked to a trivial div above, so a deep link to one of those wouldn't
    // exercise this at all.
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    renderAt('/setup/workflows');
    expect(scrollIntoView).toHaveBeenCalled();
  });
});
