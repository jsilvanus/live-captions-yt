import { visibleQuestions } from './lib/capabilities.js';
import { useSetupT } from '../../lib/useSetupT.js';
import { hasSetupText } from '../../lib/setupText.js';

/**
 * QuestionsStep — the production questions for the chosen intents, grouped by
 * intent, with a short concept explainer where one helps.
 *
 * Props:
 *   intents: Set<string>
 *   answers: Record<string, any>
 *   onChange: (answers) => void
 */
export function QuestionsStep({ intents, answers, onChange }) {
  const t = useSetupT();
  const questions = visibleQuestions(intents, answers);
  const groups = [...intents].filter(i => questions.some(q => q.intent === i));

  function setAnswer(id, value) {
    onChange({ ...answers, [id]: value });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {groups.map(intent => (
        <section key={intent} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{t(`intent.${intent}.title`)}</h3>
          {hasSetupText(`concept.${intent}`) && (
            <p data-testid={`concept-${intent}`} style={{ margin: 0, fontSize: 12, color: 'var(--color-text-muted)', background: 'var(--color-surface-2, transparent)', borderLeft: '3px solid var(--color-border)', paddingLeft: 10 }}>
              {t(`concept.${intent}`)}
            </p>
          )}
          {questions.filter(q => q.intent === intent).map(q => (
            <Question key={q.id} q={q} value={answers[q.id]} onChange={v => setAnswer(q.id, v)} t={t} />
          ))}
        </section>
      ))}
    </div>
  );
}

function Question({ q, value, onChange, t }) {
  const options = q.type === 'bool'
    ? [{ value: true, label: t('yes') }, { value: false, label: t('no') }]
    : q.options.map(o => ({ value: o, label: t(`q.${q.id}.opt.${o}`) }));

  return (
    <fieldset style={{ border: 'none', margin: 0, padding: 0 }} data-testid={`question-${q.id}`}>
      <legend style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, padding: 0 }}>{t(`q.${q.id}.label`)}</legend>
      {hasSetupText(`q.${q.id}.help`) && <p style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--color-text-muted)' }}>{t(`q.${q.id}.help`)}</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {options.map(o => (
          <label key={String(o.value)} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <input
              type="radio"
              name={q.id}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
