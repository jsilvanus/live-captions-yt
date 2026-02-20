"""Phusion Passenger WSGI entry point for cPanel hosting.

cPanel's Application Manager (Passenger) looks for a module-level
``application`` callable that conforms to the WSGI spec (PEP 3333).

Setup on cPanel:
    1. In cPanel → Software → Setup Python App, set:
         - Python version: 3.10+ (or the highest available)
         - Application root: path/to/lcyt-backend
         - Application URL: the URL you want (e.g. /api)
         - Application startup file: passenger_wsgi.py
         - Application Entry point: application
    2. Set environment variables in the Python App config:
         JWT_SECRET=<a long random string>
         ADMIN_KEY=<another secret>
         DB_PATH=/home/<user>/lcyt-backend.db   (writable path)
    3. Click "Run pip install" and install dependencies from requirements.txt,
       or run: pip install -r requirements.txt

Environment variables:
    JWT_SECRET   — Required for production. Long random string.
    ADMIN_KEY    — Required to use /keys admin endpoints.
    DB_PATH      — Path to the SQLite database file (default: next to this file).
    SESSION_TTL  — Session idle timeout in seconds (default: 7200).
"""

import sys
import os

# Ensure the package directory is on the path when Passenger runs this file
_here = os.path.dirname(os.path.abspath(__file__))
if _here not in sys.path:
    sys.path.insert(0, _here)

from lcyt_backend.app import create_app

# Passenger expects a module-level 'application' variable
application = create_app()
