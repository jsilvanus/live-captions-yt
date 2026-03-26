import { CONFIG_STEP_TEMPLATES } from './constants.js';

/**
 * Compute the ordered wizard steps based on the selected feature set.
 *
 * @param {Set<string>} selectedFeatures
 * @returns {Array<{ id: string, title: string, featureCode?: string }>}
 */
export function computeSteps(selectedFeatures) {
  const configSteps = CONFIG_STEP_TEMPLATES.filter(s =>
    selectedFeatures.has(s.featureCode)
  );

  return [
    { id: 'features', title: 'Select Features' },
    ...configSteps,
    { id: 'review',   title: 'Review' },
  ];
}
