const previewCredentials = import.meta.env.DEV
  ? {
      identifier: 'local-admin',
      secret: 'tf-local-preview-only-2026-change-before-sharing',
    }
  : null

const previewSessionToken = import.meta.env.DEV ? 'local-preview-session' : null

export function getLocalPreviewCredentials() {
  return previewCredentials
}

export function isLocalPreviewSession(): boolean {
  if (!import.meta.env.DEV || !previewSessionToken) return false
  try {
    return window.localStorage.getItem('talentflow.accessToken') === previewSessionToken
  } catch {
    return false
  }
}

export function getLocalPreviewSessionToken(): string | null {
  return previewSessionToken
}
