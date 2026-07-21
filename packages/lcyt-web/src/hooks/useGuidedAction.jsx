import { createContext, useContext, useEffect, useRef } from 'react';

/**
 * useGuidedAction — the dialog-driving primitive plan_ai_roles_framework.md
 * specs for the chat-driven-dialog agentic_chat roles (Setup/Asset Control/
 * Graphics Editor Assistant): "I can be opened, highlighted, have field X
 * set, and have my own submit/confirm button located."
 *
 * A dialog-owning component (e.g. CaptionTargetsSection) registers a handler
 * per tool name via useGuidedActionTargets(); the chat panel that received a
 * staged tool call from the backend's `confirm`-mode turn loop looks it up
 * via useGuidedActionDispatcher().dispatch(toolName, args) and invokes it —
 * which opens that section's real Add/Edit/Delete dialog, prefilled from the
 * tool call's args, and stops there. The human still clicks the dialog's own
 * submit button; this primitive only gets them to a filled-in form, it never
 * submits on their behalf (that's the `confirm` mode contract).
 *
 * A tool name with no registered handler is a normal, expected case (e.g. a
 * read-only `*.list` tool, or a role whose target surface has no matching
 * dialog yet) — dispatch() returns false and the caller decides how to
 * communicate that.
 */

const GuidedActionContext = createContext(null);

export function GuidedActionProvider({ children }) {
  const registryRef = useRef(new Map()); // toolName -> handler(args)

  const apiRef = useRef({
    register(toolName, handler) {
      registryRef.current.set(toolName, handler);
    },
    unregister(toolName, handler) {
      if (registryRef.current.get(toolName) === handler) registryRef.current.delete(toolName);
    },
    dispatch(toolName, args) {
      const handler = registryRef.current.get(toolName);
      if (!handler) return false;
      handler(args);
      return true;
    },
  });

  return (
    <GuidedActionContext.Provider value={apiRef.current}>
      {children}
    </GuidedActionContext.Provider>
  );
}

/**
 * Register a dialog-driving handler per tool name. `handlers` is a plain
 * object `{ 'caption_target.create': (args) => {...}, ... }`; each handler
 * is expected to open/prefill the corresponding dialog and return
 * synchronously (no promise to await — the chat panel doesn't wait on it).
 */
export function useGuidedActionTargets(handlers) {
  const ctx = useContext(GuidedActionContext);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!ctx) return;
    const names = Object.keys(handlersRef.current || {});
    const bound = names.map(name => (args) => handlersRef.current[name]?.(args));
    names.forEach((name, i) => ctx.register(name, bound[i]));
    return () => names.forEach((name, i) => ctx.unregister(name, bound[i]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, Object.keys(handlers || {}).join(',')]);
}

/** Returns `dispatch(toolName, args) => boolean` (true if a handler ran). */
export function useGuidedActionDispatcher() {
  const ctx = useContext(GuidedActionContext);
  return (toolName, args) => (ctx ? ctx.dispatch(toolName, args) : false);
}
