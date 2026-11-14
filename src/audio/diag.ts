/** Dev only: send a diagnostic line to the dev server (see phoneLog in vite.config.ts). */
export function diag(event: string, data?: unknown) {
  if (!import.meta.env.DEV) return
  try {
    void fetch('/__log', { method: 'POST', body: JSON.stringify({ event, data }), keepalive: true }).catch(() => {})
  } catch {
    // Diagnostics must never break capture.
  }
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.addEventListener('error', (e) => diag('window.error', e.message))
  window.addEventListener('unhandledrejection', (e) => diag('unhandledrejection', String(e.reason)))
}
