import { useCallback, useEffect, useState } from 'react';
import { useLang } from '../../contexts/LangContext.jsx';
import { useSessionApiContext } from '../../contexts/SessionApiContext.jsx';

const PAGE_SIZE = 20;

/**
 * MusicHistoryPanel — paginated timeline of server-side music detection events.
 *
 * Self-fetches via SessionApiContext.getMusicEventsHistory(); unlike MusicPanel
 * (purely presentational, client-side detector state), this panel owns its own
 * data fetching since it surfaces server-side session history, a distinct concern.
 */
export function MusicHistoryPanel() {
  const { t } = useLang();
  const { getMusicEventsHistory } = useSessionApiContext();

  const [events, setEvents] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const loadPage = useCallback(async (offset) => {
    setLoading(true);
    setError(false);
    try {
      const res = await getMusicEventsHistory({ limit: PAGE_SIZE, offset });
      setEvents(prev => (offset === 0 ? res.events : [...prev, ...res.events]));
      setTotal(res.total);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [getMusicEventsHistory]);

  useEffect(() => {
    loadPage(0);
  }, [loadPage]);

  function formatEventTime(ts) {
    try {
      return new Date(ts * 1000).toLocaleTimeString([], {
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      });
    } catch {
      return '—';
    }
  }

  function eventLabel(event) {
    if (event.event_type === 'bpm_update') {
      return `${t('settings.music.historyBpmUpdate')}: ${Math.round(event.bpm)} ${t('settings.music.bpmSuffix')}`;
    }
    return `${t('settings.music.historyLabelChange')}: ${event.label ?? '—'}`;
  }

  const hasMore = events.length < total;

  return (
    <div className="settings-field">
      <label className="settings-field__label">{t('settings.music.historyTitle')}</label>

      {events.length === 0 && !loading && !error && (
        <span className="settings-field__hint">{t('settings.music.historyEmpty')}</span>
      )}

      {error && (
        <span className="settings-field__hint">{t('settings.music.historyError')}</span>
      )}

      {events.length > 0 && (
        <ul className="music-history-list">
          {events.map(event => (
            <li key={event.id} className="music-history-list__item">
              <span className="music-history-list__time">{formatEventTime(event.ts)}</span>
              <span className="music-history-list__label">{eventLabel(event)}</span>
              {event.confidence != null && (
                <span className="music-history-list__confidence">{Math.round(event.confidence * 100)}%</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {hasMore && (
        <button
          type="button"
          className="btn btn--secondary"
          disabled={loading}
          onClick={() => loadPage(events.length)}
        >
          {loading ? t('settings.music.historyLoading') : t('settings.music.historyLoadMore')}
        </button>
      )}
    </div>
  );
}
