/**
 * TranslationPanel — vendor selection and translation pair management.
 *
 * Props:
 *   vendor: string
 *   vendorKey: string
 *   libreUrl: string
 *   libreKey: string
 *   showOriginal: boolean
 *   translationList: { id, sourceLang, targetLang }[]
 *   onChange: (patch) => void   // partial object
 */

const VENDORS = [
  { value: 'mymemory',       label: 'MyMemory (free)' },
  { value: 'google',         label: 'Google Translate' },
  { value: 'deepl',          label: 'DeepL' },
  { value: 'libretranslate', label: 'LibreTranslate' },
];

const LANGS = [
  'en-US','en-GB','es-ES','es-MX','fr-FR','de-DE','it-IT','pt-BR','pt-PT',
  'ja-JP','ko-KR','zh-CN','zh-TW','ar-SA','hi-IN','ru-RU','nl-NL','pl-PL',
  'sv-SE','da-DK','fi-FI','nb-NO','tr-TR','id-ID','th-TH','vi-VN','uk-UA',
  'cs-CZ','ro-RO','hu-HU',
];

function PairRow({ entry, onChange, onRemove }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <select
        className="settings-field__input"
        value={entry.sourceLang || 'auto'}
        onChange={e => onChange({ ...entry, sourceLang: e.target.value })}
        style={{ flex: 1 }}
      >
        <option value="auto">Auto-detect</option>
        {LANGS.map(l => <option key={l} value={l}>{l}</option>)}
      </select>
      <span style={{ color: 'var(--color-text-muted)' }}>→</span>
      <select
        className="settings-field__input"
        value={entry.targetLang || ''}
        onChange={e => onChange({ ...entry, targetLang: e.target.value })}
        style={{ flex: 1 }}
      >
        <option value="">— select —</option>
        {LANGS.map(l => <option key={l} value={l}>{l}</option>)}
      </select>
      <button
        type="button"
        className="btn btn--secondary btn--sm"
        onClick={onRemove}
        style={{ flexShrink: 0 }}
      >✕</button>
    </div>
  );
}

export function TranslationPanel({
  vendor = 'mymemory',
  vendorKey = '',
  libreUrl = '',
  libreKey = '',
  showOriginal = false,
  translationList = [],
  onChange,
}) {
  const isLibre = vendor === 'libretranslate';
  const needsKey = vendor !== 'mymemory' && vendor !== 'libretranslate';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <label className="settings-field__label">Translation provider</label>
        <select
          className="settings-field__input"
          value={vendor}
          onChange={e => onChange({ vendor: e.target.value })}
          style={{ width: '100%' }}
        >
          {VENDORS.map(v => (
            <option key={v.value} value={v.value}>{v.label}</option>
          ))}
        </select>
      </div>

      {needsKey && (
        <div>
          <label className="settings-field__label">API key</label>
          <input
            className="settings-field__input"
            type="password"
            value={vendorKey}
            onChange={e => onChange({ vendorKey: e.target.value })}
            style={{ width: '100%' }}
          />
        </div>
      )}

      {isLibre && (
        <>
          <div>
            <label className="settings-field__label">LibreTranslate URL</label>
            <input
              className="settings-field__input"
              type="text"
              placeholder="https://libretranslate.example.com"
              value={libreUrl}
              onChange={e => onChange({ libreUrl: e.target.value })}
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <label className="settings-field__label">LibreTranslate API key (optional)</label>
            <input
              className="settings-field__input"
              type="password"
              value={libreKey}
              onChange={e => onChange({ libreKey: e.target.value })}
              style={{ width: '100%' }}
            />
          </div>
        </>
      )}

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
        <input
          type="checkbox"
          checked={!!showOriginal}
          onChange={e => onChange({ showOriginal: e.target.checked })}
        />
        Show original text alongside translation
      </label>

      <div>
        <label className="settings-field__label">Language pairs</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {translationList.length === 0 && (
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>
              No pairs yet. Add one below.
            </p>
          )}
          {translationList.map((entry, i) => (
            <PairRow
              key={entry.id}
              entry={entry}
              onChange={updated => {
                const next = translationList.map((e, idx) => idx === i ? updated : e);
                onChange({ translationList: next });
              }}
              onRemove={() => onChange({ translationList: translationList.filter((_, idx) => idx !== i) })}
            />
          ))}
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            style={{ alignSelf: 'flex-start' }}
            onClick={() => onChange({ translationList: [
              ...translationList,
              { id: crypto.randomUUID(), sourceLang: 'auto', targetLang: '' },
            ] })}
          >
            + Add language pair
          </button>
        </div>
      </div>
    </div>
  );
}
