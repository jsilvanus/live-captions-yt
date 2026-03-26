import { useUserAuth } from '../../hooks/useUserAuth.js';
import { useSessionContext } from '../../contexts/SessionContext.jsx';
import { useWizardState } from './hooks/useWizardState.js';
import { WizardShell } from './WizardShell.jsx';
import { StepFeatureSelection } from './StepFeatureSelection.jsx';
import { StepReview } from './StepReview.jsx';
import { TargetsPanel } from '../panels/TargetsPanel.jsx';
import { TranslationPanel } from '../panels/TranslationPanel.jsx';
import { RelayPanel } from '../panels/RelayPanel.jsx';
import { CeaCaptionsPanel } from '../panels/CeaCaptionsPanel.jsx';
import { EmbedPanel } from '../panels/EmbedPanel.jsx';
import { SttPanel } from '../panels/SttPanel.jsx';

/**
 * SetupWizardPage — orchestrates the full wizard flow.
 * Mounted at /setup via SidebarApp.
 */
export function SetupWizardPage() {
  const { token: userToken, backendUrl: userBackendUrl } = useUserAuth();
  const session = useSessionContext();

  // Use user token for feature management (project-level operations)
  const apiKey     = session?.apiKey || '';
  const token      = userToken || '';
  const backendUrl = userBackendUrl || session?.backendUrl || '';

  const state = useWizardState(backendUrl, token, apiKey);

  const {
    selectedFeatures, configs, localSettings, stepIndex, depNotices,
    saving, saveError, initialized, steps, currentStep,
    setConfigs, setLocalSettings, setDepNotices,
    handleFeaturesChange, handleFinish, handleNext, handleBack,
    handleSkip, handleEditStep,
    nextDisabled, isLastStep, isConfigStep,
  } = state;

  if (!initialized) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <span style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>Loading…</span>
      </div>
    );
  }

  function renderStep() {
    if (!currentStep) return null;

    switch (currentStep.id) {
      case 'features':
        return (
          <StepFeatureSelection
            value={selectedFeatures}
            onChange={handleFeaturesChange}
            depNotices={depNotices}
            onDismissNotices={() => setDepNotices([])}
          />
        );

      case 'targets':
        return (
          <TargetsPanel
            targets={localSettings.targets || []}
            onChange={targets => setLocalSettings(s => ({ ...s, targets }))}
          />
        );

      case 'translation':
        return (
          <TranslationPanel
            vendor={localSettings.translationVendor || 'mymemory'}
            vendorKey={localSettings.translationVendorKey || ''}
            libreUrl={localSettings.translationLibreUrl || ''}
            libreKey={localSettings.translationLibreKey || ''}
            showOriginal={localSettings.translationShowOriginal || false}
            translationList={localSettings.translationList || []}
            onChange={patch => setLocalSettings(s => ({ ...s, ...patch }))}
          />
        );

      case 'relay':
        return (
          <RelayPanel
            relaySlots={localSettings.relaySlots || []}
            onChange={relaySlots => setLocalSettings(s => ({ ...s, relaySlots }))}
          />
        );

      case 'cea-captions':
        return (
          <CeaCaptionsPanel
            config={configs['cea-captions'] || {}}
            onChange={cfg => setConfigs(c => ({ ...c, 'cea-captions': cfg }))}
          />
        );

      case 'embed':
        return (
          <EmbedPanel
            config={configs['embed'] || {}}
            onChange={cfg => setConfigs(c => ({ ...c, embed: cfg }))}
          />
        );

      case 'stt-server':
        return (
          <SttPanel
            config={configs['stt-server'] || {}}
            onChange={cfg => setConfigs(c => ({ ...c, 'stt-server': cfg }))}
          />
        );

      case 'review':
        return (
          <StepReview
            steps={steps}
            selectedFeatures={selectedFeatures}
            localSettings={localSettings}
            configs={configs}
            onEditStep={handleEditStep}
          />
        );

      default:
        return <p style={{ color: 'var(--color-text-muted)' }}>Unknown step: {currentStep.id}</p>;
    }
  }

  return (
    <WizardShell
      title={currentStep?.title || ''}
      steps={steps}
      stepIndex={stepIndex}
      isConfigStep={isConfigStep}
      onBack={handleBack}
      onNext={handleNext}
      onSkip={handleSkip}
      onFinish={handleFinish}
      saving={saving}
      saveError={saveError}
      nextDisabled={nextDisabled}
      isLastStep={isLastStep}
    >
      {renderStep()}
    </WizardShell>
  );
}
