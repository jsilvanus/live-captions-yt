import { RelaySlotRow } from './RelaySlotRow.jsx';

const MAX_WIZARD_RELAY_SLOTS = 8;

/**
 * RelayPanel — list of RTMP relay slots.
 *
 * Props:
 *   relaySlots: object[]
 *   onChange: (relaySlots) => void
 */
export function RelayPanel({ relaySlots = [], onChange }) {
  function updateSlot(index, updated) {
    onChange(relaySlots.map((s, i) => i === index ? updated : s));
  }

  function addSlot() {
    const nextSlotNum = (relaySlots.reduce((max, s) => Math.max(max, s.slot || 0), 0)) + 1;
    onChange([...relaySlots, {
      slot: nextSlotNum,
      active: false,
      type: 'youtube',
      ytKey: '',
      genericUrl: '',
      genericName: '',
      captionMode: 'http',
      scale: '',
      fps: null,
      videoBitrate: '',
      audioBitrate: '',
    }]);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {relaySlots.length === 0 && (
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>
          No relay slots yet. Add one below.
        </p>
      )}

      {relaySlots.map((slot, i) => (
        <RelaySlotRow
          key={slot.slot}
          slot={slot}
          onChange={updated => updateSlot(i, updated)}
          defaultExpanded={i === 0}
        />
      ))}

      {relaySlots.length < MAX_WIZARD_RELAY_SLOTS && (
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          style={{ alignSelf: 'flex-start' }}
          onClick={addSlot}
        >
          + Add relay slot
        </button>
      )}
    </div>
  );
}
