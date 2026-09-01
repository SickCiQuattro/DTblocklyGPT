import React from 'react'
import { TextField, IconButton } from '@mui/material'
import { useTheme, alpha } from '@mui/material/styles'
import { ArrowUp, Mic, Square } from 'lucide-react'

import { SPEECH_LANG } from 'constants/recognitionRegistry'
import SpeechRecognition from 'utils/speechRecognition'

interface ChatComposerProps {
  isProcessing: boolean
  message: string
  setMessage: (message: string) => void
  isRecording: boolean
  setIsRecording: (recording: boolean) => void
  transcript: string
  resetTranscript: () => void
  browserSupportsSpeechRecognition: boolean
  isMicrophoneAvailable: boolean
  onMessageSend: () => void
}

export const ChatComposer: React.FC<ChatComposerProps> = ({
  isProcessing,
  message,
  setMessage,
  isRecording,
  setIsRecording,
  transcript,
  resetTranscript,
  browserSupportsSpeechRecognition,
  isMicrophoneAvailable,
  onMessageSend,
}) => {
  const theme = useTheme()
  const indigo = theme.palette.primary.dark
  const danger = theme.palette.error.main
  const canSend = message.trim().length > 0 && !isProcessing

  const startRecording = () => {
    SpeechRecognition.startListening({
      owner: 'chat-composer',
      // The same pinned language the voice-command block uses: one browser
      // recognition session is shared between them, so two different values
      // would mean whichever started last silently decided for both.
      language: SPEECH_LANG,
      continuous: true,
    })
    setIsRecording(true)
  }

  const stopRecording = () => {
    SpeechRecognition.stopListening('chat-composer')
    setMessage(transcript)
    resetTranscript()
    setIsRecording(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onMessageSend()
    }
  }

  const micDisabledReason = !browserSupportsSpeechRecognition
    ? 'Voice input isn’t supported in this browser'
    : !isMicrophoneAvailable
      ? 'Microphone access is blocked — allow it in your browser settings'
      : null
  const micTitle = micDisabledReason ?? 'Speak'

  return (
    <div style={{ padding: '12px 16px 16px' }}>
      <style>{`
        .composer-card {
          border: 1px solid ${theme.palette.divider};
          border-radius: 16px;
          background: ${theme.palette.background.paper};
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .composer-card:focus-within {
          border-color: ${alpha(indigo, 0.4)};
          box-shadow: 0 0 0 3px ${alpha(indigo, 0.1)};
        }
        @keyframes recording-pulsate {
          0% { box-shadow: 0 0 0 0 ${alpha(danger, 0.4)}; }
          70% { box-shadow: 0 0 0 8px ${alpha(danger, 0)}; }
          100% { box-shadow: 0 0 0 0 ${alpha(danger, 0)}; }
        }
        .recording-active {
          animation: recording-pulsate 1.5s infinite cubic-bezier(0.4, 0, 0.2, 1) !important;
          background: ${alpha(danger, 0.12)} !important;
        }
        @media (prefers-reduced-motion: reduce) {
          .recording-active { animation: none !important; }
        }
      `}</style>

      <div
        className="composer-card"
        style={{
          padding: '10px 10px 8px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
        }}
      >
        <TextField
          placeholder={isRecording ? 'Listening…' : 'Type a message...'}
          value={isRecording ? transcript : message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={isRecording}
          onKeyDown={handleKeyDown}
          multiline
          minRows={1}
          maxRows={6}
          variant="standard"
          slotProps={{ input: { disableUnderline: true } }}
          sx={{
            '& .MuiInputBase-input': { fontSize: '14px', padding: 0 },
          }}
        />

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          {!isRecording ? (
            <IconButton
              onClick={startRecording}
              disabled={
                isProcessing ||
                !browserSupportsSpeechRecognition ||
                !isMicrophoneAvailable
              }
              size="small"
              sx={{
                color: 'text.secondary',
                transition: 'background-color 0.15s ease, color 0.15s ease',
                '&:hover': { bgcolor: 'action.hover' },
              }}
              title={micTitle}
            >
              <Mic size={17} />
            </IconButton>
          ) : (
            <IconButton
              onClick={stopRecording}
              className="recording-active"
              size="small"
              sx={{ color: danger }}
              title="Stop Recording"
            >
              <Square size={14} fill={danger} />
            </IconButton>
          )}
          <IconButton
            disabled={!canSend}
            onClick={onMessageSend}
            size="small"
            sx={{
              width: 30,
              height: 30,
              bgcolor: canSend ? indigo : 'action.disabledBackground',
              color: canSend ? 'common.white' : 'text.disabled',
              transition: 'background-color 0.15s ease',
              '&:hover': {
                bgcolor: canSend
                  ? theme.palette.primary.darker
                  : 'action.disabledBackground',
              },
            }}
            title="Send"
          >
            <ArrowUp size={16} />
          </IconButton>
        </div>
      </div>
    </div>
  )
}
