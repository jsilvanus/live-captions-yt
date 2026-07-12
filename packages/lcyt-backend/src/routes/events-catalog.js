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
