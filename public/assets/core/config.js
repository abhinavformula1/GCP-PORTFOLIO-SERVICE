/**
 * Static client-side configuration that needs to be shared across modules.
 *
 * Client ID isn't a secret (it ships in the rendered page, ends up in the
 * GIS button's redirect_uri, etc.) so we keep it inline here. The
 * server-side OAuth verification is what actually enforces who can sign
 * in — this is just the front-end's "who am I impersonating" identifier.
 *
 * Set to an empty string to disable Google Sign-In and run the assistant
 * in guest-only mode (useful for local development without a configured
 * GCP project).
 */
export var GOOGLE_CLIENT_ID = '647206478056-rd95imm61c309o4tc5ekddgkmk50fdvp.apps.googleusercontent.com';
