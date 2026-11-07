/** `GET /api/me`: who Access let through, and what the Worker has turned on. */
export interface Me {
  readonly email: string;
  /** Whether SLACK_CLIENT_TOKEN and SLACK_D_COOKIE are set, so the create_code_channel MCP tool works. */
  readonly code_channels_enabled: boolean;
  /** True when an Access service token (an agent) authenticated, rather than a person. */
  readonly service_token: boolean;
  /** The Worker version serving the request (`CF_VERSION_METADATA`); "local" in `vite dev`. */
  readonly version: string;
}

/** A note, from `GET /api/notes` and the `notes_list` MCP tool. */
export interface Note {
  readonly id: number;
  readonly body: string;
  /** The Access email (or service token name) that added it. */
  readonly created_by: string;
  readonly created_at: string;
}

export const NOTE_MAX_LENGTH = 2000;
