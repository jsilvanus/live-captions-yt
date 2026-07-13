import { Router } from 'express';

/**
 * Event-topic catalog — the single source of truth for the topics an external
 * subscriber can request on GET /events/stream, and for the scopes a token can
 * be granted. Consumed by the Setup Hub "MCP access" scope picker so the UI and
 * the backend never drift out of sync.
 *
 * `baseScope` is the resource:verb gate the endpoint requires (checked by
 * tokenHasScope); `topics` are dotted event-topic patterns (checked by
 * tokenAllowsTopic) that narrow which events a token receives.
 *
 * Topics that carry a dynamic segment (e.g. per-variable) are listed by their
 * wildcard form plus an `example` of the concrete topic.
 *
 * TODO: once plan_metacode_variable_unification lands, source these from the
 * reserved-name registry's `emitsTopic` instead of hand-maintaining them here.
 */
export const EVENT_TOPIC_CATALOG = {
  baseScope: {
    value: 'events:read',
    label: 'Event stream access',
    description: 'Required to connect to the unified event stream (GET /events/stream).',
  },
  topics: [
    { topic: 'dsk.*', label: 'DSK graphics events', description: 'Graphics, text, bindings, template and layer changes.' },
    {
      topic: 'variable.*',
      label: 'Variable changes (all)',
      description: 'Any variable change. Each event carries the variable’s new value. Watch a single variable with variable.<name>.changed.',
      example: 'variable.section.changed',
    },
    { topic: 'cue.fired', label: 'Cue fires', description: 'A cue rule matched and fired.' },
    { topic: 'role.*', label: 'AI role & assistant events', description: 'Assistant suggestions/actions, chat tool calls, tracker/describer updates.' },
    { topic: 'caption.*', label: 'Caption results', description: 'caption.sent and caption.error for the project’s live sessions.' },
    { topic: 'session.*', label: 'Session lifecycle', description: 'Mic-lock state and session-closed events.' },
    { topic: 'external.*', label: 'External events', description: 'Events published by third-party integrations via POST /events. Only the external.* namespace is writable by external tokens.' },
    { topic: 'mcp.*', label: 'MCP tool events', description: 'Tool execution and staging events from the MCP endpoint (mcp.tool_executed, mcp.tool_staged).' },
    { topic: 'operator.*', label: 'Operator events', description: 'Hosted operator lifecycle and action events (operator.started, operator.stopped, operator.action_executed, operator.action_staged).' },
  ],
  scopes: [
    { value: 'events:read', label: 'Stream events', description: 'Connect to GET /events/stream and receive real-time events.' },
    { value: 'events:write', label: 'Publish events', description: 'Publish external.* events via POST /events.' },
    { value: 'mcp:connect', label: 'MCP endpoint', description: 'Connect to the in-process MCP endpoint (POST /mcp).' },
    { value: 'camera:read', label: 'Read cameras', description: 'List and inspect camera devices.' },
    { value: 'camera:write', label: 'Control cameras', description: 'Trigger camera presets and create/update/delete cameras.' },
    { value: 'mixer:read', label: 'Read mixers', description: 'List and inspect mixer devices.' },
    { value: 'mixer:write', label: 'Control mixers', description: 'Switch mixer inputs and create/update/delete mixers.' },
    { value: 'dsk:read', label: 'Read DSK', description: 'List DSK templates and assets.' },
    { value: 'dsk:write', label: 'Modify DSK', description: 'Generate/edit DSK templates and manage assets.' },
    { value: 'target:read', label: 'Read targets', description: 'List caption delivery targets.' },
    { value: 'target:write', label: 'Manage targets', description: 'Create/update/delete caption delivery targets.' },
    { value: 'operator:read', label: 'Operator status', description: 'View operator status and pending actions.' },
    { value: 'operator:write', label: 'Control operator', description: 'Start/stop the hosted operator and confirm/reject actions.' },
  ],
};

/**
 * Public router serving the event-topic catalog.
 * GET /events/topics → { baseScope, topics }
 * @returns {Router}
 */
export function createEventsCatalogRouter() {
  const router = Router();
  router.get('/', (_req, res) => res.json(EVENT_TOPIC_CATALOG));
  return router;
}
