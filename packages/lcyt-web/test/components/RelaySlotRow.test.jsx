import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LangProvider } from '../../src/contexts/LangContext.jsx';
import { RelaySlotRow } from '../../src/components/panels/RelaySlotRow.jsx';
import {
  setSlotSourceFeedId, getSlotSourceFeedId,
  setSlotSourceView, getSlotConfig, clearSlot, buildInitialRelayList,
} from '../../src/lib/relayConfig.js';

const FEEDS = [
  { id: 'managed:video', managed: true, name: 'Main video', kind: 'generic', label: 'main', deviceType: null, deviceId: null },
  { id: 'feed-altar', managed: false, name: 'Altar cam', kind: 'camera', label: null, deviceType: 'camera', deviceId: 'cam-1' },
  { id: 'feed-prog', managed: false, name: 'Mixer 2', kind: 'generic', label: 'program', deviceType: null, deviceId: null },
  { id: 'feed-key', managed: false, name: 'Key feed', kind: 'dsk', label: null, deviceType: null, deviceId: null },
];

function findSourceSelect(container) {
  return [...container.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'crop')) || null;
}

function renderRow(entry, props = {}) {
  const onChange = vi.fn();
  const { container } = render(
    <LangProvider>
      <RelaySlotRow
        entry={{ slot: 1, targetType: 'youtube', youtubeKey: 'k', ...entry }}
        onChange={onChange}
        onRemove={() => {}}
        feeds={FEEDS}
        {...props}
      />
    </LangProvider>,
  );
  // The source picker sits in the advanced options.
  fireEvent.click(screen.getByTitle('Advanced'));
  return { onChange, select: findSourceSelect(container) };
}

beforeEach(() => {
  localStorage.setItem('lcyt:lang', 'en');
  localStorage.clear();
});

afterEach(() => { vi.restoreAllMocks(); });

describe('RelaySlotRow source picker over feeds', () => {
  it('lists the named feeds grouped by kind and leaves managed feeds out', () => {
    const { select } = renderRow({});
    const groups = [...select.querySelectorAll('optgroup')].map(g => g.label);
    expect(groups).toEqual(['Camera feeds', 'Other feeds', 'DSK feeds']);
    const options = [...select.querySelectorAll('option')].map(o => o.textContent);
    expect(options).toEqual(['Program (main feed)', 'Vertical Crop', 'Altar cam', 'Mixer 2 (program)', 'Key feed']);
    expect(options.join('|')).not.toContain('Main video');
  });

  it('picking a feed writes sourceFeedId and the view stays program', () => {
    const { onChange, select } = renderRow({ sourceView: 'program' });
    fireEvent.change(select, { target: { value: 'feed:feed-prog' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const patch = onChange.mock.calls[0][0];
    expect(patch.sourceFeedId).toBe('feed-prog');
    expect(patch.sourceView).toBe('program');
  });

  it('shows the selected feed', () => {
    const { select } = renderRow({ sourceFeedId: 'feed-key' });
    expect(select.value).toBe('feed:feed-key');
  });

  it('hides the picker when there are no feeds and no legacy camera', () => {
    const { container } = render(
      <LangProvider>
        <RelaySlotRow entry={{ slot: 1, targetType: 'youtube', youtubeKey: 'k' }} onChange={() => {}} onRemove={() => {}} feeds={[]} />
      </LangProvider>,
    );
    fireEvent.click(screen.getByTitle('Advanced'));
    expect(findSourceSelect(container)).toBeNull();
  });
});

describe('relayConfig round trip with sourceFeedId', () => {
  it('stores, reads back and clears the feed id per slot', () => {
    setSlotSourceFeedId(2, 'feed-prog');
    expect(getSlotSourceFeedId(2)).toBe('feed-prog');
    expect(getSlotConfig(2).sourceFeedId).toBe('feed-prog');
    setSlotSourceFeedId(2, '');
    expect(getSlotSourceFeedId(2)).toBe('');
  });

  it('clearSlot removes the feed id', () => {
    setSlotSourceFeedId(3, 'feed-altar');
    expect(getSlotConfig(3)).toMatchObject({ sourceFeedId: 'feed-altar' });
    expect(getSlotConfig(3)).not.toHaveProperty('sourceCameraId');
    clearSlot(3);
    expect(getSlotSourceFeedId(3)).toBe('');
  });

  it('carries sourceFeedId into the initial relay list the Egress card edits', () => {
    setSlotTargetTypeForTest(4);
    setSlotSourceFeedId(4, 'feed-key');
    setSlotSourceView(4, 'program');
    const entry = buildInitialRelayList().find(r => r.slot === 4);
    expect(entry).toMatchObject({ sourceFeedId: 'feed-key', sourceView: 'program' });
  });
});

function setSlotTargetTypeForTest(slot) {
  localStorage.setItem(`lcyt.relay.slot${slot}.ytKey`, 'abcd-efgh');
}
