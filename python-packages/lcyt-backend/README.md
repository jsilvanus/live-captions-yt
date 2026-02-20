# lcyt-backend (Python)

Flask backend for YouTube Live caption ingestion. A Python port of the Node.js
`lcyt-backend` package, designed to run on shared cPanel hosting via Phusion Passenger.

## API

| Method   | Path          | Auth          | Description                             |
|----------|---------------|---------------|-----------------------------------------|
| `GET`    | `/health`     | none          | Health check with uptime & session count |
| `POST`   | `/live`       | API key       | Register a session, returns JWT         |
| `GET`    | `/live`       | JWT Bearer    | Get session status                      |
| `DELETE` | `/live`       | JWT Bearer    | Tear down session                       |
| `POST`   | `/captions`   | JWT Bearer    | Send one or more captions               |
| `POST`   | `/sync`       | JWT Bearer    | NTP-style clock sync                    |
| `GET`    | `/keys`       | X-Admin-Key   | List API keys                           |
| `POST`   | `/keys`       | X-Admin-Key   | Create API key                          |
| `GET`    | `/keys/<key>` | X-Admin-Key   | Get API key details                     |
| `PATCH`  | `/keys/<key>` | X-Admin-Key   | Update API key                          |
| `DELETE` | `/keys/<key>` | X-Admin-Key   | Revoke or delete API key                |

## cPanel Deployment

1. In **cPanel → Software → Setup Python App**:
   - Python version: 3.10+
   - Application root: `/home/<user>/live-captions-yt/python-packages/lcyt-backend`
   - Application startup file: `passenger_wsgi.py`
   - Application Entry point: `application`

2. Set environment variables in the Python App config:
   ```
   JWT_SECRET=<long random string>
   ADMIN_KEY=<another secret>
   DB_PATH=/home/<user>/lcyt-backend.db
   ```

3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   # or: pip install lcyt-backend
   ```

## Local Development

```bash
cd python-packages/lcyt-backend
pip install -e ".[dev]"
JWT_SECRET=dev-secret ADMIN_KEY=admin python run.py
```

## Running Tests

```bash
cd python-packages/lcyt-backend
pytest
```
