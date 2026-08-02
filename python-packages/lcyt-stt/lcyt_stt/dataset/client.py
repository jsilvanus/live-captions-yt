"""HTTP client for the crowd-source-voice admin export API.

Auth is an ordinary user JWT for an admin-role account (crowd-source-voice
has no distinct "admin token" type) — pass it in as a bearer token, e.g.
read from an env var by the caller.
"""

import httpx


class CrowdSourceVoiceClient:
    def __init__(self, base_url, token, transport=None):
        self.base_url = base_url.rstrip("/")
        self._client = httpx.Client(transport=transport, timeout=60.0, headers={"Authorization": f"Bearer {token}"})

    def close(self):
        self._client.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        self.close()

    def get_export(self, corpus_id):
        """GET /api/export?corpus_id=&format=json. Never passes include_all — training only ever consumes the validated export."""
        resp = self._client.get(f"{self.base_url}/api/export", params={"corpus_id": corpus_id, "format": "json"})
        resp.raise_for_status()
        return resp.json()

    def get_manifest(self, corpus_id):
        """GET /api/export/manifest?corpus_id= — source file paths + speaker_id."""
        resp = self._client.get(f"{self.base_url}/api/export/manifest", params={"corpus_id": corpus_id})
        resp.raise_for_status()
        return resp.json()

    def download_audio(self, source_path):
        """Fetch one recording's audio bytes.

        crowd-source-voice serves recordings statically at /uploads (no auth
        on that route) — source_path is the manifest's raw file_path.
        """
        resp = self._client.get(f"{self.base_url}/{source_path.lstrip('/')}")
        resp.raise_for_status()
        return resp.content
