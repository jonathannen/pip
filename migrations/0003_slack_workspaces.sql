-- Slack workspaces besides the home one (which is the Worker's vars and secrets): a hand-made Slack
-- app in each, added on Settings. bot_token, signing_secret, client_token and d_cookie are never
-- plain: each is AES-256-GCM ciphertext under PIP_SECRETS_KEY (src/lib/secrets.ts).
CREATE TABLE slack_workspaces (
  team_id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  workspace TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  cc_bot_ids TEXT NOT NULL DEFAULT '',
  code_app_id TEXT,
  bot_token TEXT NOT NULL,
  signing_secret TEXT NOT NULL,
  client_token TEXT,
  d_cookie TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
