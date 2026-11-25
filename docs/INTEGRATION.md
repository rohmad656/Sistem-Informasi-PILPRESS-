# React–PHP integration

The maintained frontend is `frontend/`; the selected PHP service is `backend/`. The API client reads `VITE_API_URL || '/api'`; Vite listens on port 3000 and proxies `/api` to `http://127.0.0.1:8080`. Start PHP with `backend/public` as document root and `backend/public/index.php` as router. The root README is the canonical setup guide; backend API documentation describes request/response details.

Authentication uses a Bearer token. The fixed academic panel consists of dm1/chair and dm2–dm3/member. Auth context and navigation distinguish chair/member, and the backend remains authoritative for every permission and state transition. Do not rely on hiding a button as authorization.

TOPSIS normalizes DM assessments to preference scores; Borda aggregates independent TOPSIS-derived rankings. Voting is separate: one vote per DM per round, majority at least 2/3, tie requires a new round, only chair opens/reopens/ratifies. UI consumes API results and displays final/history data rather than replacing backend decisions with mock calculations.

For a fresh session, finalize all three assessments before opening voting. A ratified session cannot simply be reused as a fresh test fixture. Keep any manual or automated integration mutations in a separately approved test database; do not reset the main installation.

Previously executed HTTP integration exercised the complete Vite → PHP → MariaDB transport for majority and tie/revote scenarios. Browser coverage only checked the public login page and public API fetches. Authenticated browser clicks are not verified. See the sanitized root test report; raw local snapshots, credentials and machine-specific process handles are intentionally absent.
