import { useState, useEffect, useRef, useCallback } from 'react';
import { useProjectFeatures } from '../../../hooks/useProjectFeatures.js';
import { computeSteps, isSkippableStep } from '../lib/computeSteps.js';
import { applyDeps } from '../lib/applyDeps.js';
import { readLocalSettings } from '../lib/readLocalSettings.js';
import { saveWizard } from '../lib/saveWizard.js';
import { DRAFT_KEY, DRAFT_VERSION } from '../lib/constants.js';
import { resolveIntent, mergeDerivedFeatures } from '../lib/capabilities.js';
import { markOnboarded } from '../../../lib/onboarding.js';

/**
 * useWizardState — all state and actions for the setup wizard.
 */
export function useWizardState(backendUrl, token, apiKey) {
  const { features, featureConfig, updateFeature, loading: featuresLoading } =
    useProjectFeatures(backendUrl, token, apiKey);

  const [selectedFeatures, setSelectedFeaturesRaw] = useState(() => new Set(['captions']));
  const [configs, setConfigs] = useState({});
  // Production-level answers (phase 1 of the wizard refactor); features derive from these
  // via resolveIntent() when setIntentAnswers() is used. The classic feature step still works.
  const [intents, setIntentsRaw] = useState(() => new Set());
  const [answers, setAnswersRaw] = useState({});
  // Features the intent answers switched on last time, so changing an answer
  // removes only those and keeps features the project already had.
  const [derivedFeatures, setDerivedFeaturesRaw] = useState(() => new Set());
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
  const steps = computeSteps(selectedFeatures, intents);

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
      // Legacy drafts (no version) were saved against the old step list; start those over.
      setStepIndex(draft.version === DRAFT_VERSION ? (draft.stepIndex || 0) : 0);
      setIntentsRaw(new Set(Array.isArray(draft.intents) ? draft.intents : []));
      setAnswersRaw(draft.answers && typeof draft.answers === 'object' ? draft.answers : {});
      setDerivedFeaturesRaw(new Set(Array.isArray(draft.derivedFeatures) ? draft.derivedFeatures : []));
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
        version: DRAFT_VERSION,
        intents: [...intents],
        answers,
        derivedFeatures: [...derivedFeatures],
        selectedFeatures: [...selectedFeatures],
        configs,
        localSettings,
        stepIndex,
      }));
    } catch {}
  }, [selectedFeatures, configs, localSettings, stepIndex, intents, answers, derivedFeatures, initialized]);

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

  /**
   * Set the production intents/answers and update the feature selection from them.
   * Only the features the previous answers derived are replaced; features the
   * project already had stay selected. Returns the resolved capabilities so the
   * UI can show steps, Hub cards and prerequisites.
   */
  const setIntentAnswers = useCallback((nextIntents, nextAnswers) => {
    const intentSet = nextIntents instanceof Set ? new Set(nextIntents) : new Set(nextIntents);
    const resolved = resolveIntent(intentSet, nextAnswers);
    const merged = mergeDerivedFeatures(selectedFeatures, derivedFeatures, resolved.features);
    setIntentsRaw(intentSet);
    setAnswersRaw(nextAnswers);
    setDerivedFeaturesRaw(new Set(resolved.features));
    setSelectedFeaturesRaw(merged);
    setDepNotices(resolved.autoEnabled);
    return resolved;
  }, [selectedFeatures, derivedFeatures]);

  const handleNext = useCallback(() => {
    setStepIndex(i => Math.min(Math.min(i, steps.length - 1) + 1, steps.length - 1));
  }, [steps.length]);

  const handleBack = useCallback(() => {
    setStepIndex(i => Math.max(Math.min(i, steps.length - 1) - 1, 0));
  }, []);

  const handleSkip = useCallback(() => {
    setStepIndex(i => Math.min(Math.min(i, steps.length - 1) + 1, steps.length - 1));
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
      markOnboarded(apiKey);
      window.location.href = '/projects';
    } catch (err) {
      setSaveError(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [selectedFeatures, configs, localSettings, updateFeature, backendUrl, token, apiKey]);

  // Steps can disappear when answers change (e.g. the questions step); keep the index valid.
  const safeIndex = Math.min(stepIndex, steps.length - 1);
  const currentStep = steps[safeIndex] || steps[0];
  const isLastStep = safeIndex === steps.length - 1;
  const isConfigStep = !!currentStep && isSkippableStep(currentStep.id);

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
    intents,
    answers,
    setIntentAnswers,
    selectedFeatures,
    configs,
    localSettings,
    stepIndex: safeIndex,
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
