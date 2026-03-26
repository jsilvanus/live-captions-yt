import { useState, useEffect, useRef, useCallback } from 'react';
import { useProjectFeatures } from '../../../hooks/useProjectFeatures.js';
import { computeSteps } from '../lib/computeSteps.js';
import { applyDeps } from '../lib/applyDeps.js';
import { readLocalSettings } from '../lib/readLocalSettings.js';
import { saveWizard } from '../lib/saveWizard.js';
import { DRAFT_KEY } from '../lib/constants.js';

/**
 * useWizardState — all state and actions for the setup wizard.
 */
export function useWizardState(backendUrl, token, apiKey) {
  const { features, featureConfig, updateFeature, loading: featuresLoading } =
    useProjectFeatures(backendUrl, token, apiKey);

  const [selectedFeatures, setSelectedFeaturesRaw] = useState(() => new Set(['captions']));
  const [configs, setConfigs] = useState({});
  const [localSettings, setLocalSettings] = useState(() => readLocalSettings());
  const [stepIndex, setStepIndex] = useState(0);
  const [depNotices, setDepNotices] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [initialized, setInitialized] = useState(false);

  // Refs for initial state (used in diff comparison on save)
  const initialFeatureSetRef = useRef(null);
  const initialConfigsRef    = useRef(null);

  // Computed steps
  const steps = computeSteps(selectedFeatures);

  // When backend features load, initialize state (once)
  useEffect(() => {
    if (featuresLoading || initialized) return;

    // Try restoring from draft first
    let draft = null;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) draft = JSON.parse(raw);
    } catch {}

    if (draft) {
      const set = new Set(draft.selectedFeatures || ['captions']);
      setSelectedFeaturesRaw(set);
      setConfigs(draft.configs || {});
      setLocalSettings(draft.localSettings || readLocalSettings());
      setStepIndex(draft.stepIndex || 0);
    } else {
      // Seed from backend features
      const backendSet = new Set(features.filter(f => f.enabled).map(f => f.code));
      if (backendSet.size === 0) backendSet.add('captions');
      setSelectedFeaturesRaw(backendSet);

      // Seed configs from backend
      const backendConfigs = {};
      features.forEach(f => {
        if (f.config) backendConfigs[f.code] = f.config;
      });
      setConfigs(backendConfigs);
    }

    // Store initial state for diff comparison
    const initSet = new Set(features.filter(f => f.enabled).map(f => f.code));
    const initCfgs = {};
    features.forEach(f => { if (f.config) initCfgs[f.code] = f.config; });
    initialFeatureSetRef.current = initSet;
    initialConfigsRef.current    = initCfgs;

    setInitialized(true);
  }, [features, featuresLoading, initialized]);

  // Persist draft on every state change
  useEffect(() => {
    if (!initialized) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        selectedFeatures: [...selectedFeatures],
        configs,
        localSettings,
        stepIndex,
      }));
    } catch {}
  }, [selectedFeatures, configs, localSettings, stepIndex, initialized]);

  // ── Actions ──────────────────────────────────────────────────

  const setSelectedFeatures = useCallback((next) => {
    setSelectedFeaturesRaw(next instanceof Set ? next : new Set(next));
  }, []);

  const handleFeaturesChange = useCallback((next) => {
    const set = next instanceof Set ? new Set(next) : new Set(next);
    const auto = applyDeps(set);
    setSelectedFeaturesRaw(set);
    if (auto.length > 0) setDepNotices(auto);
    else setDepNotices([]);
  }, []);

  const handleNext = useCallback(() => {
    setStepIndex(i => Math.min(i + 1, steps.length - 1));
  }, [steps.length]);

  const handleBack = useCallback(() => {
    setStepIndex(i => Math.max(i - 1, 0));
  }, []);

  const handleSkip = useCallback(() => {
    setStepIndex(i => Math.min(i + 1, steps.length - 1));
  }, [steps.length]);

  const handleEditStep = useCallback((idx) => {
    setStepIndex(idx);
  }, []);

  const handleFinish = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await saveWizard({
        selectedFeatures,
        configs,
        localSettings,
        updateFeature,
        initialFeatureSet: initialFeatureSetRef.current || new Set(),
        initialConfigs:    initialConfigsRef.current    || {},
        hasBackend: !!(backendUrl && token && apiKey),
      });
      window.location.href = '/projects';
    } catch (err) {
      setSaveError(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [selectedFeatures, configs, localSettings, updateFeature, backendUrl, token, apiKey]);

  const currentStep = steps[stepIndex] || steps[0];
  const isLastStep = stepIndex === steps.length - 1;
  const isConfigStep = currentStep && currentStep.id !== 'features' && currentStep.id !== 'review';

  // Next is disabled on targets step if no valid target
  const nextDisabled = (() => {
    if (currentStep?.id === 'targets') {
      const targets = localSettings?.targets || [];
      return !targets.some(t => {
        if (!t.enabled) return false;
        if (t.type === 'youtube') return !!(t.streamKey || '').trim();
        if (t.type === 'viewer')  return !!(t.viewerKey || '').trim();
        if (t.type === 'generic') return !!(t.url || '').trim();
        return false;
      });
    }
    return false;
  })();

  return {
    selectedFeatures,
    configs,
    localSettings,
    stepIndex,
    depNotices,
    saving,
    saveError,
    initialized,
    steps,
    setSelectedFeatures,
    setConfigs,
    setLocalSettings,
    setStepIndex,
    setDepNotices,
    handleFeaturesChange,
    handleFinish,
    handleNext,
    handleBack,
    handleSkip,
    handleEditStep,
    nextDisabled,
    isLastStep,
    isConfigStep,
    currentStep,
  };
}
