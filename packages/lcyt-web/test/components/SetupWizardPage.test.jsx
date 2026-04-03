import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SetupWizardPage } from '../../src/components/setup-wizard/SetupWizardPage.jsx';

// ── Context stubs ──────────────────────────────────────────────────────────────

vi.mock('../../src/hooks/useUserAuth.js', () => ({
  useUserAuth: () => ({ token: '', backendUrl: '' }),
}));

vi.mock('../../src/contexts/SessionContext.jsx', () => ({
  useSessionContext: () => ({ apiKey: '', backendUrl: '' }),
}));

// Hook mock: returns a minimal initialized state so the wizard renders content
vi.mock('../../src/components/setup-wizard/hooks/useWizardState.js', () => ({
  useWizardState: () => ({
    selectedFeatures: new Set(['captions']),
    configs: {},
    localSettings: { targets: [], translationVendor: 'mymemory', translationVendorKey: '', translationLibreUrl: '', translationLibreKey: '', translationShowOriginal: false, translationList: [], relayList: [] },
    stepIndex: 0,
    depNotices: [],
    saving: false,
    saveError: null,
    initialized: true,
    steps: [{ id: 'features', title: 'Select Features' }, { id: 'targets', title: 'Caption Targets' }, { id: 'review', title: 'Review' }],
    currentStep: { id: 'features', title: 'Select Features' },
    setConfigs: vi.fn(),
    setLocalSettings: vi.fn(),
    setDepNotices: vi.fn(),
    handleFeaturesChange: vi.fn(),
    handleFinish: vi.fn(),
    handleNext: vi.fn(),
    handleBack: vi.fn(),
    handleSkip: vi.fn(),
    handleEditStep: vi.fn(),
    nextDisabled: false,
    isLastStep: false,
    isConfigStep: false,
  }),
}));

// Stub FeaturePicker to avoid its own heavy deps
vi.mock('../../src/components/FeaturePicker.jsx', () => ({
  FeaturePicker: ({ value, onChange }) => (
    <div data-testid="feature-picker">FeaturePicker ({value.size} features)</div>
  ),
}));

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('SetupWizardPage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders without crashing', () => {
    render(<SetupWizardPage />);
  });

  it('shows the current step title in the shell', () => {
    render(<SetupWizardPage />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Select Features');
  });

  it('renders the FeaturePicker on the features step', () => {
    render(<SetupWizardPage />);
    expect(screen.getByTestId('feature-picker')).toBeInTheDocument();
  });

  it('renders WizardProgress with the correct step count', () => {
    render(<SetupWizardPage />);
    // Progress step segments: 3 steps → 3 segments (wizard-progress__seg)
    const segs = document.querySelectorAll('.wizard-progress__seg');
    expect(segs.length).toBe(3);
  });

  it('shows Next button (not Finish) when not on last step', () => {
    render(<SetupWizardPage />);
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Finish/i })).toBeNull();
  });
});
