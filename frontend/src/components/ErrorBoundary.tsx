import { Component, ErrorInfo, ReactNode } from 'react'

import { Box, Button, Typography } from '@mui/material'

/**
 * The app's only error boundary, wrapping the whole route tree.
 *
 * Without one, React unmounts the entire root when anything throws during
 * render and the page goes blank — no message, no way back. Two ways that
 * happened here, and neither is exotic:
 *
 *  - Every route is `React.lazy` behind `Loadable`, which supplies a `Suspense`
 *    fallback. `Suspense` covers the *pending* state only; a rejected dynamic
 *    import is re-thrown to the nearest boundary. In development the dev server
 *    invalidates chunks on every edit, so a reload timed against that window
 *    fails to fetch the module. In production the same thing happens to anyone
 *    who has the app open across a deploy: their index.html names chunk hashes
 *    that no longer exist.
 *  - Any ordinary render-time exception anywhere in the tree.
 *
 * A stale-chunk failure is worth telling apart from a real crash, because the
 * cure is different and the user can apply it: reloading genuinely fixes the
 * first and genuinely does not fix the second. Saying "reload" for a real crash
 * would send someone round a loop that never ends.
 */

/** A failed dynamic import, across the browsers' differing message text. */
const isChunkLoadError = (error: Error): boolean =>
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError/i.test(
    `${error.name} ${error.message}`,
  )

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the stack in the console: the UI below deliberately doesn't show it,
    // but whoever is debugging still needs it.
    console.error('Unhandled error:', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    const staleChunk = isChunkLoadError(error)

    return (
      <Box
        role="alert"
        sx={{
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
          px: 3,
          textAlign: 'center',
        }}
      >
        <Typography variant="h5" component="h1">
          {staleChunk
            ? 'This page needs to be reloaded'
            : 'Something went wrong'}
        </Typography>
        <Typography
          variant="body2"
          sx={{ color: 'text.secondary', maxWidth: 460 }}
        >
          {staleChunk
            ? 'The app was updated while it was open, so part of it could not be loaded. Reloading will pick up the new version. Nothing you saved has been lost.'
            : 'The page stopped unexpectedly. Reloading usually helps; if it keeps happening, the details are in the browser console.'}
        </Typography>
        <Button variant="contained" onClick={() => window.location.reload()}>
          Reload the page
        </Button>
      </Box>
    )
  }
}
