import { CONFIG_STEP_TEMPLATES } from './constants.js';

/**
 * Compute the ordered wizard steps.
 *
 * Without `intents` (legacy call): features → config steps → review.
 * With `intents` (a Set, possibly empty): intent → questions (only once an
 * intent is chosen) → features ("fine-tune", skippable) → config steps → review.
 *
 * @param {Set<string>} selectedFeatures
 * @param {Set<string>} [intents]
 * @returns {Array<{ id: string, title: string, featureCode?: string }>}
 */
export function computeSteps(selectedFeatures, intents) {
  const configSteps = CONFIG_STEP_TEMPLATES.filter(s =>
    selectedFeatures.has(s.featureCode)
  );

  if (!intents) {
    return [
      { id: 'features', title: 'Select Features' },
      ...configSteps,
      { id: 'review',   title: 'Review' },
    ];
  }

  return [
    { id: 'intent', title: 'What are you producing?' },
    ...(intents.size > 0 ? [{ id: 'questions', title: 'Tell us about your production' }] : []),
    { id: 'features', title: 'Fine-tune features' },
    ...configSteps,
    { id: 'review',   title: 'Review' },
  ];
}

/** Steps the user may skip with the Skip button (everything but intent and review). */
export function isSkippableStep(stepId) {
  return stepId !== 'intent' && stepId !== 'review';
}
