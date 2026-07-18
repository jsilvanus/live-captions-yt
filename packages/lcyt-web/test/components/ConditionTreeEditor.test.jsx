import { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConditionTreeEditor, summarizeConditionTree } from '../../src/components/ConditionTreeEditor.jsx';

function Controlled({ initial = null, namedConditions = [] }) {
  const [tree, setTree] = useState(initial);
  return <ConditionTreeEditor tree={tree} onChange={setTree} namedConditions={namedConditions} />;
}

describe('summarizeConditionTree()', () => {
  it('renders (empty) for a null tree', () => {
    expect(summarizeConditionTree(null)).toBe('(empty)');
  });

  it('renders a leaf with its type prefix', () => {
    expect(summarizeConditionTree({ type: 'match', matchType: 'phrase', pattern: 'Amen' })).toBe('Amen');
    expect(summarizeConditionTree({ type: 'match', matchType: 'semantic', pattern: 'end of the prayer' })).toBe('~~end of the prayer');
    expect(summarizeConditionTree({ type: 'match', matchType: 'fuzzy', pattern: 'mercy' })).toBe('~mercy');
    expect(summarizeConditionTree({ type: 'match', matchType: 'section', pattern: 'prayer' })).toBe('section:prayer');
  });

  it('renders a ref leaf', () => {
    expect(summarizeConditionTree({ type: 'ref', name: 'other-condition' })).toBe('@other-condition');
  });

  it('joins group children with the op keyword', () => {
    const tree = {
      op: 'or',
      children: [
        { type: 'match', matchType: 'phrase', pattern: 'Amen' },
        { type: 'match', matchType: 'semantic', pattern: 'end of the prayer' },
        { type: 'ref', name: 'other-condition' },
      ],
    };
    expect(summarizeConditionTree(tree)).toBe('Amen OR ~~end of the prayer OR @other-condition');
  });

  it('renders NOT with a single prefix', () => {
    const tree = { op: 'not', children: [{ type: 'match', matchType: 'section', pattern: 'intro' }] };
    expect(summarizeConditionTree(tree)).toBe('NOT section:intro');
  });
});

describe('ConditionTreeEditor', () => {
  it('shows add buttons when the tree is empty', () => {
    render(<Controlled />);
    expect(screen.getByText('No conditions yet — add one to get started.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Exact' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Ref' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ OR group' })).toBeInTheDocument();
  });

  it('adding a leaf from empty creates a root match node', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.click(screen.getByRole('button', { name: '+ Fuzzy' }));
    expect(screen.getByText('Fuzzy')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('phrase')).toBeInTheDocument();
  });

  it('adding a group from empty creates a root group with its own add row', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.click(screen.getByRole('button', { name: '+ OR group' }));
    // Two "+ Exact" buttons would be ambiguous only if nested; here there's just the one inside the new group.
    expect(screen.getAllByRole('button', { name: '+ Exact' }).length).toBe(1);
    expect(screen.getByDisplayValue('OR')).toBeInTheDocument();
  });

  it('adding children inside an existing group nests them', async () => {
    const user = userEvent.setup();
    render(<Controlled initial={{ op: 'or', children: [] }} />);
    await user.click(screen.getByRole('button', { name: '+ Exact' }));
    await user.click(screen.getByRole('button', { name: '+ Section' }));
    expect(screen.getByText('Exact')).toBeInTheDocument();
    expect(screen.getByText('Section')).toBeInTheDocument();
  });

  it('typing into a leaf pattern updates the tree', async () => {
    const user = userEvent.setup();
    render(<Controlled initial={{ type: 'match', matchType: 'phrase', pattern: '' }} />);
    await user.type(screen.getByPlaceholderText('phrase'), 'Amen');
    expect(screen.getByDisplayValue('Amen')).toBeInTheDocument();
  });

  it('removing a child leaf drops it from the group', async () => {
    const user = userEvent.setup();
    const tree = { op: 'or', children: [{ type: 'match', matchType: 'phrase', pattern: 'Amen' }, { type: 'match', matchType: 'section', pattern: 'prayer' }] };
    render(<Controlled initial={tree} />);
    expect(screen.getByDisplayValue('Amen')).toBeInTheDocument();
    await user.click(screen.getAllByTitle('Remove')[0]);
    expect(screen.queryByDisplayValue('Amen')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('prayer')).toBeInTheDocument();
  });

  it('removing the root node clears the tree back to the empty state', async () => {
    const user = userEvent.setup();
    render(<Controlled initial={{ type: 'match', matchType: 'phrase', pattern: 'Amen' }} />);
    await user.click(screen.getByTitle('Remove'));
    expect(screen.getByText('No conditions yet — add one to get started.')).toBeInTheDocument();
  });

  it('a ref leaf renders a dropdown populated from namedConditions', async () => {
    const user = userEvent.setup();
    render(<Controlled namedConditions={[{ id: '1', name: 'prayer-ending' }, { id: '2', name: 'closing' }]} />);
    await user.click(screen.getByRole('button', { name: '+ Ref' }));
    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();
    await user.selectOptions(select, 'prayer-ending');
    expect(select).toHaveValue('prayer-ending');
  });

  it('switching a group op to NOT truncates children to at most one and disables further additions', async () => {
    const user = userEvent.setup();
    const tree = { op: 'or', children: [{ type: 'match', matchType: 'phrase', pattern: 'Amen' }, { type: 'match', matchType: 'section', pattern: 'prayer' }] };
    render(<Controlled initial={tree} />);
    await user.selectOptions(screen.getByDisplayValue('OR'), 'not');
    expect(screen.getByDisplayValue('Amen')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('prayer')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Exact' })).toBeDisabled();
  });

  it('shows a warning when NOT wraps a semantic leaf', async () => {
    const tree = { op: 'not', children: [{ type: 'match', matchType: 'semantic', pattern: 'end of the prayer' }] };
    render(<Controlled initial={tree} />);
    expect(screen.getByText(/rarely fires at a meaningful moment/)).toBeInTheDocument();
  });

  it('does not warn when NOT wraps a sync leaf', async () => {
    const tree = { op: 'not', children: [{ type: 'match', matchType: 'section', pattern: 'intro' }] };
    render(<Controlled initial={tree} />);
    expect(screen.queryByText(/rarely fires at a meaningful moment/)).not.toBeInTheDocument();
  });
});
