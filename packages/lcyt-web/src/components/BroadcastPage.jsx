import { BroadcastModal } from './BroadcastModal';

/**
 * BroadcastPage — full-page Broadcast view at /broadcast.
 *
 * Renders the BroadcastModal content inline (no modal chrome, no backdrop).
 * Tabs: Encoder, YouTube, Stream (RTMP relay).
 */
export function BroadcastPage() {
  return (
    <div className="settings-page">
      <BroadcastModal inline isOpen />
    </div>
  );
}
