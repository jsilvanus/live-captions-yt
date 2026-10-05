import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LiveOverlay, describeSource } from '../../src/components/ai-observability/LiveOverlay.jsx';

describe('describeSource', () => {
  it('describes the attributed camera with method and confidence', () => {
    expect(describeSource({ cameraId: 'c1', method: 'visual-match', confidence: 0.8 }, { c1: 'Choir' })).toBe('Camera Choir · visual-match 80%');
    expect(describeSource({ cameraId: 'c1', method: 'mixer-signal', confidence: 1 })).toBe('Camera c1 · mixer-signal 100%');
  });
  it('says unknown when no camera is attributed, and nothing without a tag', () => {
    expect(describeSource({ cameraId: null, method: 'unknown' })).toBe('Source unknown');
    expect(describeSource(null)).toBeNull();
  });
});

describe('LiveOverlay perception additions', () => {
  it('shows the source badge and still renders without detector props', () => {
    const { rerender } = render(<LiveOverlay previewUrl={null} trackerObjects={[]} describerUpdate={null} />);
    expect(screen.queryByTestId('overlay-source')).toBeNull();
    rerender(<LiveOverlay previewUrl={null} trackerObjects={[]} describerUpdate={null}
      detectorSubjects={[{ trackId: 't1', label: 'person', role: 'preacher', bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.5 } }]}
      sourceTag={{ cameraId: 'c1', method: 'mixer-signal', confidence: 1 }} cameraNames={{ c1: 'Choir' }} />);
    expect(screen.getByTestId('overlay-source').textContent).toBe('Camera Choir · mixer-signal 100%');
  });
});
