import { useState } from 'react';
import { CuesManager } from '../CuesPage.jsx';
import { NamedActionsManager } from '../NamedActionsManager.jsx';
import { AgentChatPanel } from '../agent/AgentChatPanel.jsx';

const TABS = [
  { id: 'cues', icon: '📋', label: 'Cues' },
  { id: 'actions', icon: '⚡', label: 'Actions' },
];

/**
 * PlannerAssistPanel — the Planner's right column: a compact Cues/Actions
 * editor (embedded `CuesManager`/`NamedActionsManager`, same components the
 * standalone `/cues` and `/actions` pages use) above the AI assistant chat.
 * Used identically by `PlannerPage.jsx`'s desktop 3-column layout and its
 * narrow/mobile "Cues & AI" swipeable page — replaces what was previously a
 * non-functional tab stub on the narrow page and a bare `AgentChatPanel` on
 * desktop.
 */
export function PlannerAssistPanel({ chatProps }) {
  const [tab, setTab] = useState('cues');

  return (
    <div className="planner-assist-panel">
      <div className="planner-assist-panel__tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            className={`planner-assist-panel__tab${tab === t.id ? ' planner-assist-panel__tab--active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>
      <div className="planner-assist-panel__content">
        {tab === 'cues' ? <CuesManager embedded /> : <NamedActionsManager embedded />}
      </div>
      <AgentChatPanel {...chatProps} showHeader={false} />
    </div>
  );
}
