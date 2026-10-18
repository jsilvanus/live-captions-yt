import { useState } from 'react';
import { useSessionContext } from '../../contexts/SessionContext';
import { SetupCard, SetupItemRow } from './SetupCard.jsx';
import { IngestionIcon } from './icons.jsx';

/**
 * ViewerStreamSection — LCYT's own viewer stream (`hls-stream`) and the
 * operator's preview thumbnail (`preview`). No platform account is involved:
 * the live video that reaches LCYT is served as HLS at
 * `/stream-hls/<key>/index.m3u8`, and the latest frame at
 * `/preview/<key>/incoming.jpg`. Read-only: there is nothing to save, so the
 * card just gives out the links.
 */
export function ViewerStreamSection() {
  const session = useSessionContext();
  const backendUrl = session?.backendUrl;
  const apiKey = session?.apiKey;
  const [copied, setCopied] = useState(null);
  const ready = Boolean(session?.connected && backendUrl && apiKey);
  const key = apiKey ? encodeURIComponent(apiKey) : '';
  const hlsUrl = `${backendUrl}/api/v1/stream-hls/${key}/index.m3u8`;
  const previewUrl = `${backendUrl}/api/v1/preview/${key}/incoming.jpg`;

  async function copy(id, text) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(c => (c === id ? null : c)), 1500);
    } catch { /* clipboard unavailable: the link is shown in the row */ }
  }

  const copyButton = (id, url) => (
    <button type="button" className="btn btn--sm" onClick={() => copy(id, url)} data-testid={`copy-${id}`}>
      {copied === id ? 'Copied' : 'Copy link'}
    </button>
  );

  return (
    <SetupCard
      id="viewer-stream"
      icon={IngestionIcon}
      color="cyan"
      title="Viewer stream"
      description="Your own viewer stream, without any platform. Needs the live video to reach LCYT."
      status="ready"
    >
      {!ready ? (
        <p className="setup-card__empty">Connect to a project to see the stream links.</p>
      ) : (
        <>
          <SetupItemRow name="HLS video stream" meta={hlsUrl} extra={copyButton('hls', hlsUrl)} />
          <SetupItemRow name="Preview thumbnail" meta={previewUrl} extra={copyButton('preview', previewUrl)} />
        </>
      )}
    </SetupCard>
  );
}
