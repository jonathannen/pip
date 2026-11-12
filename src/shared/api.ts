/** `GET /api/me`: who Access let through, and what the Worker has turned on. */
export interface Me {
  readonly email: string;
  /** Whether SLACK_CLIENT_TOKEN and SLACK_D_COOKIE are set, so code channels can be created. */
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

/** `GET /api/deployment`: the build of pip serving the request, for Settings. */
export interface Deployment {
  /** The GitHub repository pip's source is in. */
  readonly repo: string;
  /** The commit it was built from; null when it wasn't built (`vite dev`). */
  readonly commit: string | null;
  /** The branch it was built from; null when unknown. */
  readonly branch: string | null;
  /** Whether the checkout had uncommitted changes when built. */
  readonly dirty: boolean;
  /** When `vite build` ran; null under `vite dev`. */
  readonly built_at: string | null;
  /** The Cloudflare Worker version serving it; "local" under `vite dev`. */
  readonly version_id: string;
  /** The version's tag; null without one. */
  readonly version_tag: string | null;
  /** When the version was uploaded; null under `vite dev`. */
  readonly deployed_at: string | null;
}

/** The models a Slack code channel's agent can run on, by display name. */
export const CODE_MODEL_IDS = {
  'Opus 5.5': 'claude-opus-5-5',
  'Fable 5.2': 'claude-fable-5-2',
  'Fable 5.1': 'claude-fable-5-1',
} as const;

export type CodeModel = keyof typeof CODE_MODEL_IDS;
export const CODE_MODELS = Object.keys(CODE_MODEL_IDS) as [CodeModel, ...CodeModel[]];
export const DEFAULT_CODE_MODEL: CodeModel = 'Fable 5.2';

/** Prefixed to a code channel's prompt unless asked not to. */
export const CODE_CHANNEL_PREAMBLE = 'In pynhq/pyn repo ';

/** `POST /api/code-channel`, the website's form; the same options as the MCP tool and `/cc`. */
export interface CodeChannelRequest {
  readonly prompt: string;
  readonly is_private?: boolean;
  readonly add_preamble?: boolean;
  readonly model?: CodeModel;
}

/** What creating a code channel gives back, on the API, the MCP tool and `/cc` alike. */
export interface CodeChannelResult {
  /** The prompt as sent, preamble included. */
  readonly prompt: string;
  readonly model: CodeModel;
  /** The new channel's ID and a link to it, when Slack's response named one. */
  readonly channel_id: string | null;
  readonly url: string | null;
  /** Slack's raw response, for everything else it says. */
  readonly response: Record<string, unknown>;
}
