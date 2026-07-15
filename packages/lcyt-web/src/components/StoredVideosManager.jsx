/**
 * StoredVideosManager — `/videos` page for recorded broadcast playback & management.
 * Lists recorded videos with HLS playback via hls.js and delete functionality.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useSessionContext } from '../contexts/SessionContext';
import { useProjectRequired } from '../hooks/useProjectRequired';
import { Dialog } from './Dialog';

function formatDuration(ms) {
  if (!ms || ms <= 0) return '—';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function statusBadge(status) {
  const colors = {
    recording: '#facc15',
    completed: '#22c55e',
    failed: '#ef4444',
  };
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 4,
      fontSize: 11,
      fontWeight: 600,
      textTransform: 'uppercase',
      backgroundColor: colors[status] || '#999',
      color: 'white',
    }}>
      {status || 'unknown'}
    </span>
  );
}

function VideoPlayer({ video, token, backendUrl, onClose }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);

  useEffect(() => {
    const loadHls = async () => {
      const videoEl = videoRef.current;
      if (!videoEl) return;

      try {
        const { default: Hls } = await import('hls.js');
        if (Hls.isSupported()) {
          const playlistUrl = `${backendUrl}${video.playbackUrl}${token ? `?token=${encodeURIComponent(token)}` : ''}`;
          const hls = new Hls({
            xhrSetup: (xhr) => {
              if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
            },
          });
          hls.loadSource(playlistUrl);
          hls.attachMedia(videoEl);
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            videoEl.play().catch(() => {});
          });
          hlsRef.current = hls;
        } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
          videoEl.src = `${backendUrl}${video.playbackUrl}${token ? `?token=${encodeURIComponent(token)}` : ''}`;
          videoEl.play().catch(() => {});
        }
      } catch (err) {
        console.error('HLS load error:', err.message);
      }
    };

    loadHls();
    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [video.playbackUrl, backendUrl, token]);

  return (
    <Dialog title={video.title || `Video ${video.id.slice(0, 6)}`} onClose={onClose} width="600px">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <video
          ref={videoRef}
          controls
          style={{
            width: '100%',
            maxHeight: '500px',
            borderRadius: 4,
            backgroundColor: '#000',
          }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: 'var(--color-text-dim)' }}>
          <div><strong>Status:</strong> {statusBadge(video.status)}</div>
          <div><strong>Duration:</strong> {formatDuration(video.durationMs)}</div>
          <div><strong>Size:</strong> {formatBytes(video.sizeBytes)}</div>
          <div><strong>Started:</strong> {formatDate(video.startedAt)}</div>
          <div><strong>Ended:</strong> {formatDate(video.endedAt)}</div>
        </div>
      </div>
    </Dialog>
  );
}

export function StoredVideosManager() {
  useProjectRequired();
  const session = useSessionContext();
  const connected = session?.connected;
  const backendUrl = session?.backendUrl;
  const token = session?.getSessionToken?.() ?? null;

  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [playingVideo, setPlayingVideo] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');

  const load = useCallback(async () => {
    if (!connected || !backendUrl || !token) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${backendUrl}/videos`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Backend error (${response.status}): ${text.slice(0, 100)}`);
      }
      if (!response.ok) throw new Error(data.error || 'Failed to load videos');
      setVideos(Array.isArray(data.videos) ? data.videos : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [connected, backendUrl, token]);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(id, title) {
    if (!token || !backendUrl || !confirm(`Delete "${title}"?`)) return;
    try {
      const response = await fetch(`${backendUrl}/videos/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Backend error (${response.status}): ${text.slice(0, 100)}`);
      }
      if (!response.ok) throw new Error(data.error || 'Failed to delete video');
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!connected) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: '#999' }}>
        Connect to a project to manage recorded broadcasts.
      </div>
    );
  }

  const filteredVideos = videos.filter(v => {
    if (statusFilter === 'all') return true;
    return v.status === statusFilter;
  });

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16, height: '100%', overflow: 'hidden' }}>
      <div>
        <h2 style={{ margin: '0 0 12px 0', fontSize: 16, fontWeight: 600 }}>Recorded Broadcasts</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {['all', 'recording', 'completed', 'failed'].map(status => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              style={{
                padding: '6px 12px',
                border: 'none',
                borderRadius: 4,
                backgroundColor: statusFilter === status ? '#0066cc' : '#eee',
                color: statusFilter === status ? 'white' : '#333',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: statusFilter === status ? 600 : 400,
              }}
            >
              {status === 'all' ? 'All' : status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div style={{
          padding: 12,
          backgroundColor: '#fee',
          border: '1px solid #f88',
          borderRadius: 4,
          color: '#c33',
          fontSize: 12,
        }}>
          {error}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {loading ? (
          <p style={{ textAlign: 'center', color: '#999' }}>Loading…</p>
        ) : filteredVideos.length === 0 ? (
          <p style={{ textAlign: 'center', color: '#999' }}>No recorded broadcasts.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
            {filteredVideos.map(video => (
              <div
                key={video.id}
                style={{
                  border: '1px solid #ddd',
                  borderRadius: 8,
                  padding: 12,
                  backgroundColor: '#fafafa',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.backgroundColor = '#f0f0f0';
                  e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.backgroundColor = '#fafafa';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <h3 style={{ margin: '0 0 4px 0', fontSize: 14, fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {video.title || `Video ${video.id.slice(0, 6)}`}
                  </h3>
                  <div style={{ marginLeft: 8 }}>
                    {statusBadge(video.status)}
                  </div>
                </div>

                <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
                  <div>⏱ {formatDuration(video.durationMs)}</div>
                  <div>💾 {formatBytes(video.sizeBytes)}</div>
                  {video.startedAt && <div>▶ {formatDate(video.startedAt)}</div>}
                </div>

                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    className="btn btn--sm"
                    onClick={() => setPlayingVideo(video)}
                    style={{ flex: 1 }}
                  >
                    Play
                  </button>
                  <button
                    className="btn btn--danger btn--sm"
                    onClick={() => handleDelete(video.id, video.title || 'Video')}
                    style={{ flex: 1 }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {playingVideo && (
        <VideoPlayer
          video={playingVideo}
          token={token}
          backendUrl={backendUrl}
          onClose={() => setPlayingVideo(null)}
        />
      )}
    </div>
  );
}
