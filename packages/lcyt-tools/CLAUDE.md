# `packages/lcyt-tools` — Shared Tool-Schema/Handler Registry (v0.1.0)

New top-level workspace package (not under `packages/plugins/` — it's a schema/handler library with no Express router or DB migration of its own, so it doesn't fit the plugin contract). Implements `plan_mcp.md`'s shared tool-schema module: every tool an `agentic_chat` role (`plan_ai_roles_framework.md`) needs is defined **once**, here, with the same schema an MCP client would see.

**Main entry:** `src/index.js`

**Usage (composition root only — `lcyt-backend/src/server.js`):**
```js
import { createToolRegistry, createInProcessMcpBridge } from 'lcyt-tools';

const toolRegistry = createToolRegistry({
  db,
  captionTargets: { getCaptionTargets, createCaptionTarget, updateCaptionTarget, deleteCaptionTarget }, // from 'lcyt-backend/db'
  production: { registry, bridgeManager, listCameras, getCameraById, createCamera, updateCamera, deleteCamera,
                listMixers, getMixerById, createMixer, updateMixer, deleteMixer, buildSwitchCommand },   // from 'lcyt-production'
  agent,                                                                                                  // AgentEngine instance
  assets: { listImages, getImageByKey, updateImageSettings, deleteImage },                                // from 'lcyt-dsk'
  crop: { cropManager, getCropConfig, getCropPreset, listCropPresets },                                   // from 'lcyt-rtmp'
});

// Real MCP Server + in-process Client wiring, for lcyt-agent's agentic_chat turn loop
const toolBridge = createInProcessMcpBridge(toolRegistry);
const callTool = (name, args, { apiKey }) => toolBridge.callToolAs(apiKey, name, args);
```

Each of the five dep groups (`captionTargets`, `production`, `agent`, `assets`, `crop`) is optional — `createToolRegistry` only builds the tool groups whose deps were actually provided, useful for tests that only care about one group.

**Source files (`src/`):**
- `index.js` — `createToolRegistry(deps)`: assembles all tool groups into `{ tools, callTool, byName }`. `callTool(name, args, { apiKey })` throws for an unknown tool name or a missing `apiKey`. `createInProcessMcpBridge(registry, serverInfo?)`: registers the registry on a real `@modelcontextprotocol/sdk` `Server`, connects an in-process `Client` over `InMemoryTransport.createLinkedPair()`. `apiKey` is threaded through as a reserved `_apiKey` argument (stripped before it reaches the handler) rather than via the SDK's `authInfo` — the `Client` class has no supported way to attach out-of-band auth context to an outgoing request; `authInfo` is populated server-side from a transport's own auth layer, not settable by a `Client` for itself.
- `tools/caption-targets.js` — `caption_target.list/create/update/delete`. Wraps `lcyt-backend/db`'s caption-target helpers.
- `tools/cameras.js` — `camera.list/create/update/delete/preset`. `camera.preset` replicates `routes/cameras.js`'s bridge-vs-direct dispatch (checks `camera.bridgeInstanceId` + `bridgeManager` before falling back to `registry.callPreset()`).
- `tools/mixers.js` — `mixer.list/create/update/delete/switch`. `mixer.switch` uses the shared `buildSwitchCommand()` (extracted from `lcyt-production/src/routes/mixers.js` into `crud.js` so both the HTTP route and this tool share one implementation).
- `tools/dsk-templates.js` — `dsk_template.generate/edit/suggest_styles`. Thin wrappers around `AgentEngine.generateTemplate`/`editTemplate`/`suggestStyles` — all three are `readOnlyHint: true` since none of them write to the database (they compute and return template JSON, same as `POST /agent/generate-template` et al. already do).
- `tools/assets.js` — `asset.list/update/delete`. "Assets" are `caption_files` rows with `type='image'` (DSK overlay images) — upload isn't a tool (a tool-calling LLM turn has no binary payload to attach; upload stays on the existing multipart `/images` POST route).
- `tools/crop.js` — `crop.list_presets` (readOnlyHint)/`crop.activate_preset` (destructiveHint) — recall a vertical-crop preset (plan_vertical_crop.md §4), mirroring `routes/crop.js`'s `GET /crop/presets`/`POST /crop/presets/:id/activate` exactly. Unlike cameras/mixers (project-wide, unscoped tables), crop config/presets are scoped per apiKey, so these handlers use the real per-call `ctx.apiKey`. In the Production Assistant role's `available_tools` (`lcyt-agent`'s `ai-roles.js`) alongside `camera.preset`/`mixer.switch`. **Not wired the same way as the route:** `mixer.switch`/`camera.preset` call `registry.switchSource()`/`callPreset()` directly rather than going through `routes/mixers.js`/`routes/cameras.js`, so an AI-tool-driven switch/preset recall does not itself fire `lcyt-production`'s production-follow notification — see CONSIDER.md.

**Tool annotations:** every tool sets MCP's standard `destructiveHint`/`readOnlyHint` — `destructiveHint: true` on every delete/switch/preset/state-changing tool, `readOnlyHint: true` on every list/get tool. This is the external-client equivalent of the in-app `confirm` mode: Claude Desktop/Code already surface `destructiveHint: true` as an approval prompt.

**Tests:** `test/tool-registry.test.js` (registry assembly, per-tool-group fake deps, annotation coverage, `callTool` error paths — including `crop.list_presets`/`crop.activate_preset`: apiKey-scoped preset lists, applying with an explicit vs. crop_config-default `transitionMs`, unknown-preset and renderer-not-running error paths), `test/in-process-bridge.test.js` (real MCP `Server`/`Client` round-trip via `InMemoryTransport` — `tools/list` parity, `_apiKey` scoping/stripping, error surfacing as a real MCP tool error not a thrown exception).

---

**Not yet wired:** `lcyt-mcp-stdio`/`lcyt-mcp-http` do not register this registry's `Server` object for external clients — `lcyt-mcp-http` is a separate OS process with no in-process access to the live `DeviceRegistry`/`BridgeManager`/`AgentEngine` instances these tools need (unlike its existing production/graphics tools, which proxy over HTTP with a static global `X-Admin-Key`/`X-API-Key`, not this registry's per-connection `apiKey` scoping). See root `CONSIDER.md` for the open architecture question this raises before that half gets built. `packages/plugins/lcyt-agent`'s `CLAUDE.md` documents the one consumer wired up today (the `agentic_chat` turn loop, in-process).
