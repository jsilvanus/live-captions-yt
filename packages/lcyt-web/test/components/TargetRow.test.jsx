/**
 * Tests for TargetRow — focus on the viewer icon toggle (iconEnabled) and its
 * effect on the generated viewer URL and the icon dropdown.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TargetRow } from '../../src/components/panels/TargetRow.jsx';
import { LangProvider } from '../../src/contexts/LangContext.jsx';

const BACKEND = 'https://api.example.com';
const ICONS = [{ id: 1, filename: 'logo.png' }, { id: 2, filename: 'mark.svg' }];

function renderRow(entry, onChange = vi.fn()) {
  const utils = render(
    <LangProvider>
      <TargetRow entry={entry} onChange={onChange} onRemove={vi.fn()} backendUrl={BACKEND} icons={ICONS} />
    </LangProvider>,
  );
  return { onChange, ...utils };
}

function viewerLink() {
  return [...document.querySelectorAll('a')].find(a => a.href.includes('/view/'));
}

// TargetRow renders two <select>s for a viewer target (type + icon); the icon
// one is the select that lists the uploaded icon filenames.
function iconSelect() {
  return [...document.querySelectorAll('select')].find(
    s => [...s.options].some(o => o.textContent === 'logo.png'),
  );
}

describe('TargetRow — viewer icon toggle', () => {
  const base = { id: 't1', type: 'viewer', enabled: true, viewerKey: 'my-viewer' };

  it('omits &icon from the viewer URL when the icon is disabled', () => {
    renderRow({ ...base, iconId: 1, iconEnabled: false });
    expect(viewerLink().href).not.toContain('icon=');
  });

  it('includes &icon when enabled and an icon is selected', () => {
    renderRow({ ...base, iconId: 2, iconEnabled: true });
    expect(viewerLink().href).toContain('icon=2');
  });

  it('omits &icon when enabled but no icon is selected', () => {
    renderRow({ ...base, iconId: null, iconEnabled: true });
    expect(viewerLink().href).not.toContain('icon=');
  });

  it('legacy config (iconId set, iconEnabled undefined) still shows the icon', () => {
    renderRow({ ...base, iconId: 1 });
    expect(viewerLink().href).toContain('icon=1');
  });

  it('checkbox toggles iconEnabled without clearing iconId', () => {
    const { onChange } = renderRow({ ...base, iconId: 1, iconEnabled: true });
    fireEvent.click(screen.getByLabelText('Show icon on viewer page'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ iconEnabled: false, iconId: 1 }));
  });

  it('disables the icon dropdown when the toggle is off', () => {
    renderRow({ ...base, iconId: 1, iconEnabled: false });
    expect(iconSelect()).toBeDisabled();
  });

  it('enables the icon dropdown when the toggle is on', () => {
    renderRow({ ...base, iconId: 1, iconEnabled: true });
    expect(iconSelect()).not.toBeDisabled();
  });
});
