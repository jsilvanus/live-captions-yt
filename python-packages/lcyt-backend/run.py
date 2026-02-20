"""Development server entry point.

Usage:
    python run.py

Environment variables:
    PORT         — Port to listen on (default: 3000)
    JWT_SECRET   — JWT signing secret (auto-generated if not set)
    ADMIN_KEY    — Admin key for /keys routes (disabled if not set)
    DB_PATH      — SQLite database path
"""

import os
from lcyt_backend.app import create_app

if __name__ == "__main__":
    app = create_app()
    port = int(os.environ.get("PORT", 3000))
    app.run(host="0.0.0.0", port=port, debug=False)
