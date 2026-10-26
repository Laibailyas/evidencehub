/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the deployed API Gateway. Empty/undefined → app runs in MOCK mode. */
  readonly VITE_API_BASE?: string;
  /** Sign-in page URL for the current environment, used for logout and expired sessions. */
  readonly VITE_SIGNIN_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
