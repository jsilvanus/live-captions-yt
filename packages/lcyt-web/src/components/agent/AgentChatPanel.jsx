import { useState, useRef, useEffect } from 'react';

/**
 * AgentChatPanel — a generic chat-style UI for talking to an AI assistant.
 * Deliberately knows nothing about rundowns, DSK templates, or any specific
 * `/agent/*` route: the caller owns the message list and supplies `onSend`,
 * so this same component drops into Planner, the Graphics Editor, or any
 * future page without changes. When the agent endpoints get rebuilt, only
 * each page's `onSend` wiring needs to change — not this component.
 *
 * Use `useAgentChat()` for a ready-made message-list state helper.
 */

let _msgId = 0;
function nextMessageId() { return `msg-${++_msgId}-${Date.now()}`; }

export function useAgentChat() {
  const [messages, setMessages] = useState([]); // { id, role: 'user' | 'assistant', text }

  function addMessage(role, text) {
    const msg = { id: nextMessageId(), role, text };
    setMessages(prev => [...prev, msg]);
    return msg;
  }

  function clear() {
    setMessages([]);
  }

  return { messages, addMessage, clear };
}

export function AgentChatPanel({
  title = 'AI Assistant',
  subtitle,
  messages,
  onSend,
  loading = false,
  error = '',
  disabled = false,
  disabledMessage = 'Connect to a backend with AI configured to use the assistant.',
  quickActions,
  isNarrow = false,
  // Set false when embedding this as tab/panel content that already has its
  // own header and show/hide mechanism (e.g. a tab strip) — skips the
  // column chrome (width, border, collapse toggle) and just fills whatever
  // container it's given.
  showHeader = true,
}) {
  const [draft, setDraft] = useState('');
  const [collapsed, setCollapsed] = useState(() => isNarrow);
  const listRef = useRef(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, loading]);

  function submit() {
    const text = draft.trim();
    if (!text || loading || disabled) return;
    setDraft('');
    onSend(text);
  }

  const Wrapper = showHeader ? 'aside' : 'div';
  const isOpen = !showHeader || !collapsed;

  return (
    <Wrapper className={showHeader ? 'agent-chat' : 'agent-chat agent-chat--embedded'}>
      {showHeader && (
        <button
          className="agent-chat__header"
          onClick={() => setCollapsed(v => !v)}
          aria-expanded={!collapsed}
        >
          <span className="agent-chat__header-icon" aria-hidden="true">✨</span>
          <span className="agent-chat__header-title">{title}</span>
          <span className="agent-chat__header-toggle" aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
        </button>
      )}

      {isOpen && (
        <div className="agent-chat__body">
          {subtitle && <p className="agent-chat__subtitle">{subtitle}</p>}

          {disabled ? (
            <p className="agent-chat__disabled">{disabledMessage}</p>
          ) : (
            <>
              {quickActions && quickActions.length > 0 && (
                <div className="agent-chat__quick-actions">
                  {quickActions.map(a => (
                    <button
                      key={a.label}
                      className="btn btn--secondary btn--sm"
                      onClick={a.onClick}
                      disabled={loading}
                      title={a.title}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              )}

              <div className="agent-chat__messages" ref={listRef}>
                {messages.length === 0 && (
                  <div className="agent-chat__empty">Ask for a first draft, or describe a change to make.</div>
                )}
                {messages.map(m => (
                  <div key={m.id} className={`agent-chat__msg agent-chat__msg--${m.role}`}>
                    <div className="agent-chat__msg-bubble">{m.text}</div>
                  </div>
                ))}
                {loading && (
                  <div className="agent-chat__msg agent-chat__msg--assistant">
                    <div className="agent-chat__msg-bubble agent-chat__msg-bubble--loading" aria-label="Assistant is responding">
                      <span className="agent-chat__dot" />
                      <span className="agent-chat__dot" />
                      <span className="agent-chat__dot" />
                    </div>
                  </div>
                )}
              </div>

              {error && <p className="agent-chat__error">{error}</p>}

              <div className="agent-chat__composer">
                <textarea
                  className="agent-chat__input"
                  rows={2}
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
                  }}
                  placeholder="Describe what you want…"
                  disabled={loading}
                />
                <button className="btn btn--primary btn--sm" onClick={submit} disabled={loading || !draft.trim()}>
                  {loading ? '…' : 'Send'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </Wrapper>
  );
}
