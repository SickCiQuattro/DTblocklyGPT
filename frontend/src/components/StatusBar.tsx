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
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        fontFamily: "'Geist Mono', monospace",
        color: theme.palette.text.secondary,
        zIndex: 10,
        boxSizing: 'border-box',
      }}
    >
      {/* Left side: Simulation status */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: isSimulationRunning
              ? theme.palette.success.main
              : theme.palette.text.disabled,
            display: 'inline-block',
          }}
        />
        <Typography
          aria-live="polite"
          sx={{
            fontFamily: 'inherit',
            fontSize: '0.74rem',
            fontWeight: 500,
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
      <Box>
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
          {saveError
            ? 'Save failed — check your connection'
            : justSaved
              ? 'Saved ✓'
              : lastSaved
                ? `Saved at ${lastSaved}`
                : UI_TEXT.unsavedChanges}
        </Typography>
      </Box>

      {/* Right side: View Code toggle */}
      <Box>
        <Button
          onClick={() => dispatch(toggleCode())}
          size="small"
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
