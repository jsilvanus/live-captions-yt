import { useContext, useState } from 'react';
import { SessionContext } from '../../contexts/SessionContext';
import { AgentChatPanel, useAgentChat } from './AgentChatPanel.jsx';
import { useGuidedActionDispatcher } from '../../hooks/useGuidedAction.jsx';

/**
 * RoleAssistantPanel — the chat-driven-dialog side of the three
 * `agentic_chat` roles plan_ai_roles_framework.md calls Setup Assistant,
 * Asset Control Assistant, and Graphics Editor Assistant: `<AgentChatPanel>`
 * wired to `POST /roles/:roleCode/message`. Graphics Editor Assistant
 * doesn't use this (DskEditorPage.jsx's dialog-free generate/edit flow
 * predates and doesn't need the guided-action mechanism below) — this
 * component is for Setup Assistant and Asset Control Assistant, which
 * previously had zero frontend presence.
 *
 * On a `confirm`-mode turn (the safety-gate default — see ai-roles.js's
 * effectiveMode()), the backend never executes a create/update/delete tool
 * call itself; it stages it and returns it as `pendingActions`. This panel
 * hands each one to useGuidedActionDispatcher(), which opens the real
 * Setup Hub / Assets dialog for that tool, pre-filled from the call's args —
 * the human still has to click that dialog's own submit button. A tool with
 * no registered dialog handler (a `*.list` read, or a role whose target
 * surface has no matching dialog yet) is reported in the chat instead of
 * silently doing nothing.
 */
export function RoleAssistantPanel({ roleCode, title, subtitle, showHeader = true, isNarrow = false }) {
  const session = useContext(SessionContext);
  const backendUrl = session?.backendUrl || '';
  const { messages, addMessage } = useAgentChat();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const dispatch = useGuidedActionDispatcher();

  function agentFetch(path, body) {
    const token = session?.getSessionToken?.();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return fetch(`${backendUrl}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  }

  async function handleSend(text) {
    if (loading) return;
    addMessage('user', text);
    setLoading(true);
    setError('');
    try {
      const res = await agentFetch(`/roles/${roleCode}/message`, { text });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);

      if (data.reply) addMessage('assistant', data.reply);

      for (const action of data.pendingActions || []) {
        const handled = dispatch(action.name, action.args);
        addMessage('assistant', handled
          ? `Opened the "${action.name}" form, pre-filled from your request — review it and click its own submit button to confirm.`
          : `Proposed calling "${action.name}" with ${JSON.stringify(action.args)} — no interactive dialog is wired up for this yet, so nothing was changed.`);
      }

      if (!data.reply && !(data.pendingActions || []).length) {
        addMessage('assistant', '(no response)');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AgentChatPanel
      title={title}
      subtitle={subtitle}
      messages={messages}
      onSend={handleSend}
      loading={loading}
      error={error}
      disabled={!session?.connected}
      disabledMessage="Connect to a project, then enable this role from the Setup Hub's AI role models card, to use the assistant."
      showHeader={showHeader}
      isNarrow={isNarrow}
    />
  );
}
