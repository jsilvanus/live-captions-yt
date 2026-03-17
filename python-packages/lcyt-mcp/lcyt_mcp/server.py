"""MCP server for lcyt — sends live captions to YouTube Live streams."""

import asyncio
import json
import os
import secrets
from datetime import datetime, timezone
from typing import Any

import httpx
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp import types

# ── Backend helpers ───────────────────────────────────────────────────────────

BACKEND_URL = os.environ.get("LCYT_BACKEND_URL", "").rstrip("/")
API_KEY     = os.environ.get("LCYT_API_KEY", "")
ADMIN_KEY   = os.environ.get("LCYT_ADMIN_KEY", "")


def _admin_headers() -> dict:
    return {"X-Admin-Key": ADMIN_KEY}


def _editor_headers() -> dict:
    return {"X-API-Key": API_KEY}


async def _backend_get(path: str, headers: dict) -> str:
    if not BACKEND_URL:
        return json.dumps({"error": "LCYT_BACKEND_URL is not configured"})
    async with httpx.AsyncClient() as client:
        r = await client.get(f"{BACKEND_URL}{path}", headers=headers)
        return r.text


async def _backend_post(path: str, headers: dict, body: dict | None = None) -> str:
    if not BACKEND_URL:
        return json.dumps({"error": "LCYT_BACKEND_URL is not configured"})
    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{BACKEND_URL}{path}",
            headers={"Content-Type": "application/json", **headers},
            json=body,
        )
        return r.text

# ── Tool definitions ─────────────────────────────────────────────────────────

TOOLS: list[types.Tool] = [
    types.Tool(
        name="start",
        description="Create a caption sender and start a session. Returns a session_id.",
        inputSchema={
            "type": "object",
            "properties": {
                "stream_key": {
                    "type": "string",
                    "description": "YouTube Live stream key (cid value).",
                },
            },
            "required": ["stream_key"],
        },
    ),
    types.Tool(
        name="send_caption",
        description="Send a single caption to the live stream.",
        inputSchema={
            "type": "object",
            "properties": {
                "session_id": {"type": "string"},
                "text": {"type": "string", "description": "Caption text to send."},
                "timestamp": {
                    "type": "string",
                    "description": "ISO-8601 timestamp. Omit to use the current time.",
                },
            },
            "required": ["session_id", "text"],
        },
    ),
    types.Tool(
        name="send_batch",
        description="Send multiple captions atomically.",
        inputSchema={
            "type": "object",
            "properties": {
                "session_id": {"type": "string"},
                "captions": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "text": {"type": "string"},
                            "timestamp": {"type": "string"},
                        },
                        "required": ["text"],
                    },
                    "description": "Array of {text, timestamp?} objects.",
                },
            },
            "required": ["session_id", "captions"],
        },
    ),
    types.Tool(
        name="sync_clock",
        description=(
            "NTP-style round-trip to YouTube to compute clock sync offset. "
            "Returns syncOffset in ms."
        ),
        inputSchema={
            "type": "object",
            "properties": {"session_id": {"type": "string"}},
            "required": ["session_id"],
        },
    ),
    types.Tool(
        name="get_status",
        description="Return current sequence number and sync offset for the session.",
        inputSchema={
            "type": "object",
            "properties": {"session_id": {"type": "string"}},
            "required": ["session_id"],
        },
    ),
    types.Tool(
        name="stop",
        description="End the session and clean up the sender.",
        inputSchema={
            "type": "object",
            "properties": {"session_id": {"type": "string"}},
            "required": ["session_id"],
        },
    ),

    # ── Production tools ──────────────────────────────────────────────────────
    types.Tool(
        name="list_cameras",
        description="List all cameras with their id, name, mixerInput, controlType, and controlConfig.",
        inputSchema={"type": "object", "properties": {}},
    ),
    types.Tool(
        name="camera_preset",
        description="Trigger a PTZ preset on a camera. Returns { ok, cameraId, presetId }.",
        inputSchema={
            "type": "object",
            "properties": {
                "camera_id": {"type": "string", "description": "Camera ID."},
                "preset_id": {"type": "string", "description": "Preset ID to trigger."},
            },
            "required": ["camera_id", "preset_id"],
        },
    ),
    types.Tool(
        name="list_mixers",
        description="List all mixers with id, name, type, connected, and activeSource.",
        inputSchema={"type": "object", "properties": {}},
    ),
    types.Tool(
        name="switch_source",
        description="Switch the mixer's live program source. Returns { ok, mixerId, activeSource }.",
        inputSchema={
            "type": "object",
            "properties": {
                "mixer_id": {"type": "string", "description": "Mixer ID."},
                "input": {"type": "integer", "minimum": 1, "description": "Input number (positive integer)."},
            },
            "required": ["mixer_id", "input"],
        },
    ),

    # ── Graphics / DSK tools ──────────────────────────────────────────────────
    types.Tool(
        name="list_dsk_templates",
        description="List all saved DSK overlay templates for the API key. Returns [{ id, name, updated_at }].",
        inputSchema={"type": "object", "properties": {}},
    ),
    types.Tool(
        name="activate_dsk_template",
        description="Load a DSK template into the Playwright renderer. Returns { ok, id, name }.",
        inputSchema={
            "type": "object",
            "properties": {
                "template_id": {"type": "integer", "description": "Template ID to activate."},
            },
            "required": ["template_id"],
        },
    ),
    types.Tool(
        name="broadcast_dsk_data",
        description="Inject live text into the renderer DOM without page reload. Accepts an array of {selector, text} objects.",
        inputSchema={
            "type": "object",
            "properties": {
                "updates": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "selector": {"type": "string", "description": "CSS selector to target."},
                            "text": {"type": "string", "description": "Text to inject."},
                        },
                        "required": ["selector", "text"],
                    },
                    "description": "Array of {selector, text} updates.",
                },
            },
            "required": ["updates"],
        },
    ),
    types.Tool(
        name="dsk_renderer_status",
        description="Get DSK renderer running state for the API key. Returns { running, rtmpUrl? }.",
        inputSchema={"type": "object", "properties": {}},
    ),
    types.Tool(
        name="start_dsk_renderer",
        description="Start DSK Playwright capture loop → ffmpeg → nginx-rtmp. Returns { ok, rtmpUrl }.",
        inputSchema={"type": "object", "properties": {}},
    ),
    types.Tool(
        name="stop_dsk_renderer",
        description="Stop DSK capture loop and ffmpeg. Returns { ok }.",
        inputSchema={"type": "object", "properties": {}},
    ),
]

# ── Handler factory (exported for testing with a fake sender) ────────────────


def create_handlers(SenderClass=None):
    """
    Return a dict of handler coroutines backed by an isolated sessions store.

    Pass a custom *SenderClass* to inject a fake in tests; omit it to use the
    real ``YoutubeLiveCaptionSender`` from the ``lcyt`` package (imported
    lazily so ``lcyt`` is not required when testing with a fake).
    """
    if SenderClass is None:
        from lcyt import YoutubeLiveCaptionSender  # lazy import

        SenderClass = YoutubeLiveCaptionSender

    sessions: dict[str, Any] = {}
    session_meta: dict[str, dict] = {}

    def _get_session(session_id: str):
        sender = sessions.get(session_id)
        if sender is None:
            raise ValueError(f"Unknown session_id: {session_id!r}")
        return sender

    async def list_tools() -> list[types.Tool]:
        return TOOLS

    async def list_resources() -> list[types.Resource]:
        return [
            types.Resource(
                uri=f"session://{sid}",
                name=f"Session {sid}",
                description="JSON snapshot of the caption session state.",
                mimeType="application/json",
            )
            for sid in sessions
        ]

    async def read_resource(uri: str) -> str:
        prefix = "session://"
        if not uri.startswith(prefix):
            raise ValueError(f"Unknown resource URI: {uri!r}")
        session_id = uri[len(prefix):]
        sender = _get_session(session_id)
        meta = session_meta.get(session_id, {})
        return json.dumps({
            "sequence": sender.get_sequence(),
            "syncOffset": sender.get_sync_offset(),
            "startedAt": meta.get("startedAt"),
        })

    async def call_tool(name: str, arguments: dict) -> list[types.TextContent]:
        match name:
            case "start":
                sender = SenderClass(stream_key=arguments["stream_key"])
                await asyncio.to_thread(sender.start)
                sid = secrets.token_hex(8)
                sessions[sid] = sender
                session_meta[sid] = {
                    "startedAt": datetime.now(tz=timezone.utc).isoformat()
                }
                return [types.TextContent(type="text", text=json.dumps({"session_id": sid}))]

            case "send_caption":
                sender = _get_session(arguments["session_id"])
                ts = arguments.get("timestamp")
                result = await asyncio.to_thread(sender.send, arguments["text"], ts)
                return [types.TextContent(
                    type="text",
                    text=json.dumps({"ok": True, "sequence": result.sequence}),
                )]

            case "send_batch":
                sender = _get_session(arguments["session_id"])
                result = await asyncio.to_thread(sender.send_batch, arguments["captions"])
                return [types.TextContent(
                    type="text",
                    text=json.dumps({"ok": True, "sequence": result.sequence, "count": result.count}),
                )]

            case "sync_clock":
                sender = _get_session(arguments["session_id"])
                result = await asyncio.to_thread(sender.sync)
                return [types.TextContent(
                    type="text",
                    text=json.dumps({"syncOffset": result["sync_offset"]}),
                )]

            case "get_status":
                sender = _get_session(arguments["session_id"])
                return [types.TextContent(
                    type="text",
                    text=json.dumps({
                        "sequence": sender.get_sequence(),
                        "syncOffset": sender.get_sync_offset(),
                    }),
                )]

            case "stop":
                sender = sessions.pop(arguments["session_id"], None)
                if sender is None:
                    raise ValueError(f"Unknown session_id: {arguments['session_id']!r}")
                session_meta.pop(arguments["session_id"], None)
                await asyncio.to_thread(sender.end)
                return [types.TextContent(type="text", text=json.dumps({"ok": True}))]

            # ── Production tools ───────────────────────────────────────────

            case "list_cameras":
                return [types.TextContent(
                    type="text",
                    text=await _backend_get("/production/cameras", _admin_headers()),
                )]

            case "camera_preset":
                cid, pid = arguments["camera_id"], arguments["preset_id"]
                return [types.TextContent(
                    type="text",
                    text=await _backend_post(f"/production/cameras/{cid}/preset/{pid}", _admin_headers()),
                )]

            case "list_mixers":
                return [types.TextContent(
                    type="text",
                    text=await _backend_get("/production/mixers", _admin_headers()),
                )]

            case "switch_source":
                mid, inp = arguments["mixer_id"], arguments["input"]
                return [types.TextContent(
                    type="text",
                    text=await _backend_post(f"/production/mixers/{mid}/switch/{inp}", _admin_headers()),
                )]

            # ── Graphics / DSK tools ───────────────────────────────────────

            case "list_dsk_templates":
                return [types.TextContent(
                    type="text",
                    text=await _backend_get(f"/dsk/{API_KEY}/templates", _editor_headers()),
                )]

            case "activate_dsk_template":
                tid = arguments["template_id"]
                return [types.TextContent(
                    type="text",
                    text=await _backend_post(f"/dsk/{API_KEY}/templates/{tid}/activate", _editor_headers()),
                )]

            case "broadcast_dsk_data":
                return [types.TextContent(
                    type="text",
                    text=await _backend_post(
                        f"/dsk/{API_KEY}/broadcast",
                        _editor_headers(),
                        {"updates": arguments["updates"]},
                    ),
                )]

            case "dsk_renderer_status":
                return [types.TextContent(
                    type="text",
                    text=await _backend_get(f"/dsk/{API_KEY}/renderer/status", _editor_headers()),
                )]

            case "start_dsk_renderer":
                return [types.TextContent(
                    type="text",
                    text=await _backend_post(f"/dsk/{API_KEY}/renderer/start", _editor_headers()),
                )]

            case "stop_dsk_renderer":
                return [types.TextContent(
                    type="text",
                    text=await _backend_post(f"/dsk/{API_KEY}/renderer/stop", _editor_headers()),
                )]

            case _:
                raise ValueError(f"Unknown tool: {name!r}")

    return {
        "sessions": sessions,
        "session_meta": session_meta,
        "list_tools": list_tools,
        "list_resources": list_resources,
        "read_resource": read_resource,
        "call_tool": call_tool,
    }


# ── Entry point ───────────────────────────────────────────────────────────────


async def main() -> None:
    """Wire up the MCP server and serve over stdio."""
    h = create_handlers()  # imports lcyt here, not at module load time

    app = Server("lcyt-mcp")

    @app.list_tools()
    async def _list_tools():
        return await h["list_tools"]()

    @app.list_resources()
    async def _list_resources():
        return await h["list_resources"]()

    @app.read_resource()
    async def _read_resource(uri: str) -> str:
        return await h["read_resource"](uri)

    @app.call_tool()
    async def _call_tool(name: str, arguments: dict):
        return await h["call_tool"](name, arguments)

    async with stdio_server() as (read_stream, write_stream):
        await app.run(read_stream, write_stream, app.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
