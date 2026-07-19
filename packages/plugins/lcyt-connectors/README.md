# lcyt-connectors — API Connectors & Variables Plugin

Project-scoped `{{name}}` variable bindings backed by user-defined outbound API Connectors. Implements [`docs/plans/plan_api_connectors_variables.md`](../../../docs/plans/plan_api_connectors_variables.md).

**Version:** 0.1.0
**License:** (none right now)

## Overview

lcyt-connectors provides:
- **API Connectors** — reusable outbound HTTP endpoints (base URL, auth, headers)
- **Requests** — named calls nested under a connector (method, path, query, body, response mapping)
- **Variables** — project-scoped `{{name}}` values, either set manually or refreshed by a connector request
- **Metacode-triggered refresh** — three tiers (`!api:` pointer, `api:` send-async, `api!:` prefetch), never by the `{{ }}` insertion syntax itself

## Installation

```bash
npm install lcyt-connectors
```

## Quick Start

In `lcyt-backend`:

```javascript
import { initConnectors, createConnectorsRouter, createVariablesRouter } from 'lcyt-connectors';

const { bus, engine, scheduler, pollScheduler } = initConnectors(db, { filesControl: { resolveStorage } });

app.use('/connectors', createConnectorsRouter(db, auth, pollScheduler));
app.use('/variables', createVariablesRouter(db, auth, bus, engine, scheduler, jwtSecret));
```

`pollScheduler` is optional — omit the third argument to `createConnectorsRouter` to disable the constant-poll toggle route (`PUT .../poll` then 501s instead).

## API Routes

```
GET/POST/PUT/DELETE /connectors                              — API Connector CRUD (auth_config masked on read); GET embeds each connector's requests
GET/POST/PUT/DELETE /connectors/:connectorSlug/requests       — nested Request CRUD
GET/POST/PUT/DELETE /connectors/:connectorSlug/requests/:requestSlug/mappings — response mapping CRUD
PUT    /connectors/:connectorSlug/requests/:requestSlug/poll  — { enabled } toggle constant poll (session-long, pointer-independent background refresh; separate from !api:/api:/api!:)

GET    /variables                — snapshot: { [name]: { value, source, defaultValue, resolvedAt } }
POST   /variables                — create a manual variable { name, value?, defaultValue? } (400 if name starts with '_')
PUT    /variables/:name          — update a manual variable's value/default
DELETE /variables/:name          — remove a manual variable

POST   /variables/refresh        — { connectorSlug, requestSlug, waitMs? }
                                     waitMs omitted  → fire-and-forget, 202
                                     waitMs provided → races the call; 200 if it lands in time, else 202
```

## Metacode Syntax

```
<!-- !api:connectorSlug.requestSlug -->    pointer tier  — fires once on pointer arrival, fire-and-forget
<!-- api:connectorSlug.requestSlug -->     send tier     — fires at send, async, non-blocking
<!-- api!:connectorSlug.requestSlug -->    prefetch tier — background refresh while pointer is on the line;
                                                            small blocking fallback (150-250ms) at send
```

Multiple triggers per line are comma-separated: `<!-- api!:weather.current,login.token -->`.

`{{name}}` anywhere in caption/rundown text is a pure read of the variable's current value — it never triggers a fetch.

## Database Schema

Four `api_key`-scoped tables — see `src/db.js` for the full migration (matches plan §3 exactly):

- `api_connectors` — `id`, `api_key`, `name`, `slug` (unique per key), `base_url`, `auth_type`, `auth_config` (masked on read), `headers`
- `api_requests` — `id`, `connector_id`, `name`, `slug` (unique per connector), `method`, `path`, `query_params`, `body_type`, `body_content`, `response_type`, `prefetch_interval_ms`, `timeout_ms`
- `api_response_mappings` — `id`, `request_id`, `json_path`, `variable_name`, `skip_if_null`, `sort_order`
- `variables` — `(api_key, name)` primary key, `current_value`, `default_value`, `source` (`manual`|`connector`), `source_request_id`, `resolved_at`

## Testing

```bash
npm test -w packages/plugins/lcyt-connectors
```

Tests cover connector/request/mapping CRUD, variable CRUD and the fallback chain, `{{ }}` interpolation, the minimal JSONPath evaluator, the resolution engine (mocked `fetch`), and full HTTP route round-trips.

## See Also

- [Plan: API Connectors & Variables](../../../docs/plans/plan_api_connectors_variables.md)
- [LCYT backend documentation](../../lcyt-backend/README.md)
