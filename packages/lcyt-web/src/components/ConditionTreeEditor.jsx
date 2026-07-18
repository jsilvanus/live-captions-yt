import { useState } from 'react';

/**
 * ConditionTreeEditor — recursive editor for the Phase 9 condition-tree shape
 * (`docs/plans/plan_cues.md` "Composite block grammar" / "DB schema"):
 *   leaf:  { type: 'match', matchType: 'phrase'|'fuzzy'|'semantic'|'section'|'track'|'event_cue', pattern }
 *   group: { op: 'and'|'or'|'not', children: [...] }
 *   ref:   { type: 'ref', name }
 *
 * Shared by CuesManager's composite rule edit form and its Named Conditions
 * section (a named condition's `condition_tree` and a composite rule's
 * `condition_tree` are the identical shape — same component either way).
 *
 * Controlled component: `tree` is the current root node (or null/undefined
 * for "no conditions yet"), `onChange(nextTree)` fires on every edit —
 * passing `null` means "cleared back to empty."
 */

const LEAF_TYPES = [
  { matchType: 'phrase', label: 'Exact', prefix: '' },
  { matchType: 'fuzzy', label: 'Fuzzy', prefix: '~' },
  { matchType: 'semantic', label: 'Semantic', prefix: '~~' },
  { matchType: 'section', label: 'Section', prefix: 'section:' },
  { matchType: 'track', label: 'Track', prefix: 'track:' },
  { matchType: 'event_cue', label: 'Event', prefix: 'event:' },
];
const LEAF_BY_TYPE = LEAF_TYPES.reduce((acc, t) => { acc[t.matchType] = t; return acc; }, {});
const ASYNC_LEAF_TYPES = new Set(['semantic', 'event_cue']);

/** Compact one-line rendering of a tree, e.g. "Amen OR ~~end of the prayer OR @other". */
export function summarizeConditionTree(node) {
  if (!node) return '(empty)';
  if (node.type === 'ref') return `@${node.name || '?'}`;
  if (node.op) {
    const parts = (node.children || []).map(summarizeConditionTree);
    if (node.op === 'not') return `NOT ${parts[0] || '(empty)'}`;
    return parts.length ? parts.join(` ${node.op.toUpperCase()} `) : `${node.op.toUpperCase()} (empty)`;
  }
  const leafType = LEAF_BY_TYPE[node.matchType];
  return `${leafType?.prefix || ''}${node.pattern || ''}`;
}

function LeafAddButtons({ onAddLeaf, onAddRef, onAddGroup, disabled }) {
  return (
    <div className="condition-add-row">
      {LEAF_TYPES.map(lt => (
        <button
          key={lt.matchType}
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => onAddLeaf(lt.matchType)}
          disabled={disabled}
        >
          + {lt.label}
        </button>
      ))}
      <button type="button" className="btn btn--ghost btn--sm" onClick={onAddRef} disabled={disabled}>+ Ref</button>
      <span className="condition-add-row__sep" />
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => onAddGroup('and')} disabled={disabled}>+ AND group</button>
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => onAddGroup('or')} disabled={disabled}>+ OR group</button>
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => onAddGroup('not')} disabled={disabled}>+ NOT group</button>
    </div>
  );
}

function RefLeaf({ node, onChange, onRemove, namedConditions }) {
  return (
    <div className="condition-node condition-node--leaf">
      <span className="condition-node__badge condition-node__badge--ref">@ref</span>
      <select
        className="settings-field__input"
        value={node.name || ''}
        onChange={e => onChange({ ...node, name: e.target.value })}
      >
        <option value="">Select a named condition…</option>
        {namedConditions.map(nc => (
          <option key={nc.id || nc.name} value={nc.name}>{nc.name}</option>
        ))}
      </select>
      {onRemove && <button type="button" className="condition-node__remove" onClick={onRemove} title="Remove">×</button>}
    </div>
  );
}

function MatchLeaf({ node, onChange, onRemove }) {
  const leafType = LEAF_BY_TYPE[node.matchType];
  return (
    <div className="condition-node condition-node--leaf">
      <span className="condition-node__badge">{leafType?.label || node.matchType}</span>
      <input
        className="settings-field__input"
        type="text"
        value={node.pattern || ''}
        onChange={e => onChange({ ...node, pattern: e.target.value })}
        placeholder={node.matchType === 'section' ? 'section name' : node.matchType === 'track' ? 'tracked label' : 'phrase'}
      />
      {onRemove && <button type="button" className="condition-node__remove" onClick={onRemove} title="Remove">×</button>}
    </div>
  );
}

function GroupNode({ node, onChange, onRemove, namedConditions }) {
  const [collapsed, setCollapsed] = useState(false);
  const children = node.children || [];
  const isNot = node.op === 'not';
  const atNotLimit = isNot && children.length >= 1;

  function updateChild(idx, nextChild) {
    onChange({ ...node, children: children.map((c, i) => i === idx ? nextChild : c) });
  }
  function removeChild(idx) {
    onChange({ ...node, children: children.filter((_, i) => i !== idx) });
  }
  function addChild(child) {
    if (atNotLimit) return;
    onChange({ ...node, children: [...children, child] });
  }
  function changeOp(nextOp) {
    onChange({ ...node, op: nextOp, children: nextOp === 'not' ? children.slice(0, 1) : children });
  }

  const notWarning = isNot && children[0] && (
    children[0].type === 'ref' || (children[0].matchType && ASYNC_LEAF_TYPES.has(children[0].matchType))
  );

  return (
    <div className={`condition-group condition-group--${node.op}`}>
      <div className="condition-group__header">
        <button type="button" className="condition-group__collapse" onClick={() => setCollapsed(c => !c)} aria-label={collapsed ? 'Expand' : 'Collapse'}>
          {collapsed ? '▸' : '▾'}
        </button>
        <select className="settings-field__input condition-group__op" value={node.op} onChange={e => changeOp(e.target.value)}>
          <option value="and">AND</option>
          <option value="or">OR</option>
          <option value="not">NOT</option>
        </select>
        {onRemove && <button type="button" className="condition-node__remove" onClick={onRemove} title="Remove group">×</button>}
      </div>
      {!collapsed && (
        <div className="condition-group__body">
          {notWarning && (
            <p className="condition-group__warning">
              NOT wrapping a semantic/event/ref condition rarely fires at a meaningful moment — "this hasn't happened" is true almost all the time.
            </p>
          )}
          {children.map((child, idx) => (
            <ConditionNode
              key={idx}
              node={child}
              onChange={c => updateChild(idx, c)}
              onRemove={() => removeChild(idx)}
              namedConditions={namedConditions}
            />
          ))}
          <LeafAddButtons
            disabled={atNotLimit}
            onAddLeaf={matchType => addChild({ type: 'match', matchType, pattern: '' })}
            onAddRef={() => addChild({ type: 'ref', name: '' })}
            onAddGroup={op => addChild({ op, children: [] })}
          />
        </div>
      )}
    </div>
  );
}

function ConditionNode({ node, onChange, onRemove, namedConditions }) {
  if (!node) return null;
  if (node.type === 'ref') return <RefLeaf node={node} onChange={onChange} onRemove={onRemove} namedConditions={namedConditions} />;
  if (node.op) return <GroupNode node={node} onChange={onChange} onRemove={onRemove} namedConditions={namedConditions} />;
  return <MatchLeaf node={node} onChange={onChange} onRemove={onRemove} />;
}

export function ConditionTreeEditor({ tree, onChange, namedConditions = [] }) {
  if (!tree) {
    return (
      <div className="condition-tree-editor condition-tree-editor--empty">
        <p className="condition-tree-editor__empty-hint">No conditions yet — add one to get started.</p>
        <LeafAddButtons
          onAddLeaf={matchType => onChange({ type: 'match', matchType, pattern: '' })}
          onAddRef={() => onChange({ type: 'ref', name: '' })}
          onAddGroup={op => onChange({ op, children: [] })}
        />
      </div>
    );
  }
  return (
    <div className="condition-tree-editor">
      <ConditionNode node={tree} onChange={onChange} onRemove={() => onChange(null)} namedConditions={namedConditions} />
    </div>
  );
}
