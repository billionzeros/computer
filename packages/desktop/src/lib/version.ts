declare const __APP_VERSION__: string

/** Frontend version injected at build time by Vite (from package.json). */
export const FRONTEND_VERSION: string =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'
