import React from 'react'
import { Box, Typography, Button } from '@mui/material'
import { alpha, useTheme } from '@mui/material/styles'
import { useDispatch } from 'react-redux'
import { Code } from 'lucide-react'

import { useAppSelector } from 'store/reducers'
import { toggleCode, triggerSavedFlash } from 'store/reducers/task'
import { UI_TEXT } from 'constants/uiVocabulary'

export const StatusBar: React.FC = () => {
  const theme = useTheme()
  const dispatch = useDispatch()
  const lastSaved = useAppSelector((state) => state.task.lastSaved)
  const codeOpen = useAppSelector((state) => state.task.codeOpen)
  const savedFlash = useAppSelector((state) => state.task.savedFlash)
  const saveError = useAppSelector((state) => state.task.saveError)
  const hasUnsavedEdits = useAppSelector((state) => state.task.hasUnsavedEdits)
  const isSimulationRunning = useAppSelector(
    (state) => state.simulation.isRunning,
  )
  const executionTarget = useAppSelector(
    (state) => state.simulation.executionTarget,
  )

  // Brief "Saved ✓" flash driven by a dedicated one-shot Redux flag, fired
  // only by a genuine save round-trip (task-workspace/index.tsx) — NOT
  // derived from lastSaved changing, since lastSaved is also seeded from the
  // task's own last_modified on load/task-switch and that must display the
  // timestamp quietly, without flashing the checkmark as if a save just
  // happened.
  const [justSaved, setJustSaved] = React.useState(false)
  React.useEffect(() => {
    if (!savedFlash) return
    setJustSaved(true)
    // Reset the Redux flag inside the same timeout that clears the local
    // flash, not synchronously here — dispatching it right away would flip
    // savedFlash back to false within this same tick, re-running this effect
    // and firing its cleanup (clearTimeout) before the 2s window elapses,
    // canceling the flash-off almost immediately after it starts.
    const timer = setTimeout(() => {
      setJustSaved(false)
      dispatch(triggerSavedFlash(false))
    }, 2000)
    return () => clearTimeout(timer)
  }, [savedFlash, dispatch])

  return (
    <Box
      sx={{
        height: '40px',
        minHeight: '40px',
        bgcolor: 'background.default',
        // A grid, not space-between. With three flex children the middle one
        // is centred only while the outer two happen to be the same width, and
        // these two never are: the left label swings between "Not running" and
        // "Simulation running", so the save state slid sideways every time a
        // run started or ended. `1fr auto 1fr` pins it to the true centre
        // whatever the neighbours do.
        display: 'grid',
        gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'center',
        padding: '0 20px',
        fontFamily: "'Geist Mono', monospace",
        color: theme.palette.text.secondary,
        zIndex: 10,
        boxSizing: 'border-box',
      }}
    >
      {/* Left: is a program running, and where. The app's only persistent
          answer to that question — the robot panel says it too, but only while
          it is open, and it is closed by default. */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Box
          component="span"
          sx={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: isSimulationRunning
              ? 'success.main'
              : 'text.disabled',
            display: 'inline-block',
            flexShrink: 0,
            // A run is the one state on this bar that is ongoing rather than
            // finished, and a dot that only changes colour reads as another
            // static badge in the periphery. Motion is what separates "running
            // now" from "ran"; it stops when the run does.
            ...(isSimulationRunning && {
              animation: 'statusPulse 1.6s ease-in-out infinite',
              '@keyframes statusPulse': {
                '0%, 100%': { opacity: 1 },
                '50%': { opacity: 0.35 },
              },
              '@media (prefers-reduced-motion: reduce)': {
                animation: 'none',
              },
            }),
          }}
        />
        <Typography
          aria-live="polite"
          sx={{
            fontFamily: 'inherit',
            fontSize: '0.74rem',
            fontWeight: isSimulationRunning ? 700 : 500,
            color: isSimulationRunning ? 'success.dark' : 'inherit',
            whiteSpace: 'nowrap',
          }}
        >
          {isSimulationRunning
            ? executionTarget === 'real'
              ? UI_TEXT.robotRunning
              : UI_TEXT.simulationRunning
            : UI_TEXT.idle}
        </Typography>
      </Box>

      {/* Center: Last saved timestamp, brief success flash on save */}
      <Box sx={{ justifySelf: 'center' }}>
        <Typography
          role={saveError ? 'alert' : undefined}
          aria-live={saveError ? undefined : 'polite'}
          sx={{
            fontFamily: 'inherit',
            fontSize: justSaved ? '0.8rem' : '0.74rem',
            fontWeight: justSaved || saveError ? 700 : 500,
            color: saveError
              ? 'error.dark'
              : justSaved
                ? 'success.dark'
                : 'inherit',
            transition: 'color 0.6s ease, font-size 0.3s ease',
          }}
        >
          {/* hasUnsavedEdits comes before lastSaved on purpose. lastSaved is a
              timestamp of the last successful save; rendering it whenever it
              exists turned a past event into a claim about the present, so the
              bar read "Saved at 10:31" during the 2s autosave debounce — and
              kept reading it if the user navigated away inside that window,
              which cancels the pending save outright. With this, "Saved at X"
              means what a reader already takes it to mean: saved then, and
              nothing has changed since. */}
          {saveError
            ? 'Save failed — see the notification for why'
            : justSaved
              ? 'Saved ✓'
              : hasUnsavedEdits
                ? UI_TEXT.unsavedChanges
                : lastSaved
                  ? `Saved at ${lastSaved}`
                  : UI_TEXT.notSavedYet}
        </Typography>
      </Box>

      {/* Right side: View Code toggle */}
      <Box sx={{ justifySelf: 'end' }}>
        <Button
          onClick={() => dispatch(toggleCode())}
          size="small"
          aria-expanded={codeOpen}
          startIcon={<Code size={14} />}
          sx={{
            fontFamily: "'Geist Mono', monospace",
            fontSize: '0.74rem',
            textTransform: 'none',
            fontWeight: 500,
            color: codeOpen ? 'primary.main' : 'inherit',
            minWidth: 0,
            padding: '2px 8px',
            '&:hover': {
              bgcolor: alpha(theme.palette.primary.main, 0.04),
            },
          }}
        >
          {codeOpen ? 'Hide Code' : 'View Code'}
        </Button>
      </Box>
    </Box>
  )
}
