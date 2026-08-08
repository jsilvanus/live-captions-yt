/**
 * Tests for MemberRow — the 5-role access-level badge/select and the
 * owner-row protection (no editable select, no remove button) for the
 * project-roles feature (plan_project_roles.md Phase 3).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemberRow } from '../../src/components/MemberRow.jsx';

function renderRow(member, overrides = {}) {
  const onRemove = vi.fn();
  const onChangeLevel = vi.fn();
  const utils = render(
    <MemberRow
      member={member}
      currentUserAccessLevel="owner"
      onRemove={onRemove}
      onChangeLevel={onChangeLevel}
      {...overrides}
    />
  );
  return { onRemove, onChangeLevel, ...utils };
}

describe('MemberRow', () => {
  it('renders a plain badge (no select, no remove) for an owner row', () => {
    renderRow({ userId: 'u1', email: 'owner@example.com', accessLevel: 'owner', permissions: [] });
    expect(screen.getByText('owner')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
  });

  it('renders an editable access-level select for a non-owner row when the acting user can mutate', () => {
    renderRow({ userId: 'u2', email: 'editor@example.com', accessLevel: 'editor', permissions: [] });
    const select = screen.getByRole('combobox');
    expect(select.value).toBe('editor');
    expect([...select.options].map(o => o.value)).toEqual(['admin', 'editor', 'operator', 'viewer']);
  });

  it('calls onChangeLevel with the userId and new level on select change', () => {
    const { onChangeLevel } = renderRow({ userId: 'u2', email: 'editor@example.com', accessLevel: 'editor', permissions: [] });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'operator' } });
    expect(onChangeLevel).toHaveBeenCalledWith('u2', 'operator');
  });

  it('renders a plain badge, not a select, for a non-owner row when the acting user cannot mutate', () => {
    renderRow(
      { userId: 'u2', email: 'editor@example.com', accessLevel: 'editor', permissions: [] },
      { currentUserAccessLevel: 'viewer' }
    );
    expect(screen.getByText('editor')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('shows the Remove button for a non-owner row when the acting user can mutate', () => {
    renderRow({ userId: 'u2', email: 'editor@example.com', accessLevel: 'editor', permissions: [] });
    expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument();
  });

  it('calls onRemove with the userId when Remove is clicked', () => {
    const { onRemove } = renderRow({ userId: 'u2', email: 'editor@example.com', accessLevel: 'editor', permissions: [] });
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    expect(onRemove).toHaveBeenCalledWith('u2');
  });
});
