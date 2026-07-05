import { useEffect } from 'react'

// Per-page tab title (WCAG 2.4.2). Restores the default on unmount so
// navigating away never leaves a stale title behind.
export function useDocumentTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} — DTblocklyGPT` : 'DTblocklyGPT'
    return () => {
      document.title = 'DTblocklyGPT'
    }
  }, [title])
}
