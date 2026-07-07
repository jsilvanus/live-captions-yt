# Dockerized lcyt-bridge + Ollama

A second, simpler deployment mode for `lcyt-bridge` (alongside the pkg-compiled
desktop executable): a plain Node.js container, compose-networked with an
official `ollama/ollama` container. See `docs/plans/plan_ai_model_registry.md`
("Deployment Mode: Dockerized Bridge + Ollama").

## Why

Ollama has no built-in authentication — anything that can reach its HTTP port
can call any model on it. The common failure mode when running Ollama "for LAN
access" is binding it to `0.0.0.0` and exposing it to the whole home/office
network. This compose file instead puts Ollama on a private network reachable
from **exactly one thing: the bridge container**. It is never bound to any
host-facing interface.

The LCYT backend reaches this Ollama through the bridge's SSE command channel
(`http_request` for model discovery, `model_call` for inference), so the
backend never needs network access to the Ollama box at all.

## Setup

1. Create a bridge instance on your LCYT backend and note its token:
   `POST /production/bridge/instances` (or via the web UI's production setup).

2. Start the stack:

   ```bash
   cd docker/lcyt-bridge-ollama
   BACKEND_URL=https://your-backend.example BRIDGE_TOKEN=<token> docker compose up -d
   ```

3. Pull the models you want:

   ```bash
   docker compose exec ollama ollama pull llama3.1:8b
   docker compose exec ollama ollama pull llava        # vision
   ```

4. In LCYT, create an AI provider (`POST /ai/providers` or the Setup Hub UI):
   - kind: `ollama`
   - base_url: `http://ollama:11434` (the Docker-internal service name)
   - bridge instance: the instance whose token this bridge runs with

5. Trigger discovery (`POST /ai/providers/:id/discover`) — the pulled models
   appear in the provider's model catalog.

## Notes

- The same bridge process can still relay AMX/Roland/ATEM/OBS commands if it
  also has real LAN access — nothing here requires choosing one mode
  exclusively. Add the relevant network to the `lcyt-bridge` service for that.
- The desktop pkg build (`packages/lcyt-bridge`, `npm run build:win|mac|linux`)
  remains the right choice when the bridge must sit next to AV hardware on a
  desktop machine.
