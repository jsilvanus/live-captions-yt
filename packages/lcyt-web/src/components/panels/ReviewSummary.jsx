/**
 * ReviewSummary — compact summary card for a single config step.
 *
 * Props:
 *   step: { id, title }
 *   localSettings: object
 *   configs: Record<string, object>
 */
export function ReviewSummary({ step, localSettings, configs }) {
  if (step.id === 'targets') {
    const targets = localSettings?.targets || [];
    if (targets.length === 0) {
      return <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>No targets configured.</p>;
    }
    return (
      <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13 }}>
        {targets.map(t => (
          <li key={t.id} style={{ color: t.enabled ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
            {t.type}
            {t.type === 'youtube' && t.streamKey ? ': ••••' + (t.streamKey.length >= 4 ? t.streamKey.slice(-4) : '••••') : ''}
            {t.type === 'viewer'  && t.viewerKey  ? `: ${t.viewerKey}` : ''}
            {t.type === 'generic' && t.url        ? `: ${t.url}` : ''}
            {!t.enabled ? ' (disabled)' : ''}
          </li>
        ))}
      </ul>
    );
  }

  if (step.id === 'translation') {
    const list = localSettings?.translationList || [];
    return (
      <div style={{ fontSize: 13 }}>
        <p style={{ margin: '0 0 4px' }}>Provider: {localSettings?.translationVendor || 'mymemory'}</p>
        {list.length > 0 && (
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {list.map(e => (
              <li key={e.id}>{e.sourceLang || 'auto'} → {e.targetLang || '?'}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (step.id === 'relay') {
    const slots = localSettings?.relaySlots || [];
    if (slots.length === 0) return <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>No relay slots configured.</p>;
    return (
      <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13 }}>
        {slots.map(s => (
          <li key={s.slot}>
            Slot {s.slot}: {s.type || 'youtube'}{s.active ? '' : ' (inactive)'}
          </li>
        ))}
      </ul>
    );
  }

  if (step.id === 'cea-captions') {
    const cfg = configs?.['cea-captions'] || {};
    return <p style={{ fontSize: 13, margin: 0 }}>Delay: {cfg.delay_ms ?? 0} ms</p>;
  }

  if (step.id === 'embed') {
    const cfg = configs?.['embed'] || {};
    return <p style={{ fontSize: 13, margin: 0 }}>CORS: {cfg.cors || '*'}</p>;
  }

  if (step.id === 'stt-server') {
    const cfg = configs?.['stt-server'] || {};
    return (
      <p style={{ fontSize: 13, margin: 0 }}>
        {cfg.provider || 'google'} · {cfg.language || 'en-US'} · {cfg.audioSource || 'hls'}
      </p>
    );
  }

  return null;
}
