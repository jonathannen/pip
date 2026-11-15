-- The Google refresh token from /auth/google, for the Gmail draft tools. One row: pip has one owner.
CREATE TABLE google_auth (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  refresh_token TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
