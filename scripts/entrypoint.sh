#!/bin/sh
# Start lcyt-backend (port 3000) and lcyt-mcp-sse (port 3001) together.
# Forwards SIGTERM/SIGINT to both children so they shut down cleanly.

node packages/lcyt-backend/src/index.js &
BACKEND_PID=$!

node packages/lcyt-mcp-sse/src/server.js &
MCP_PID=$!

trap "kill $BACKEND_PID $MCP_PID 2>/dev/null" TERM INT

wait $BACKEND_PID $MCP_PID
