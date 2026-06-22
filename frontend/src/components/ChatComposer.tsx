import React from 'react'
import { Box, TextField, IconButton, Stack } from '@mui/material'
import { Send, Mic, Square, Volume2, VolumeX } from 'lucide-react'
import SpeechRecognition from 'react-speech-recognition'
import dayjs from 'dayjs'
import { useDispatch } from 'react-redux'

import { formatTimeFrontend } from 'utils/date'
import { MethodHTTP, fetchApi } from 'services/api'
import { endpoints } from 'services/endpoints'
import { setProposedTask } from 'store/reducers/proposal'
import { MessageType, UserChatEnum, MessageTypeEnum } from 'utils/chat'
import { blocklyToAbstract, CustomBlock } from 'utils/blocklyParser'

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
  speaker: boolean
  setSpeaker: (speaker: boolean) => void
  speaking: boolean
  onStopSpeaking: () => void
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
  speaker,
  setSpeaker,
  speaking,
  onStopSpeaking,
}) => {
  const startRecording = () => {
    SpeechRecognition.startListening({
      // Match the speaker's own language (browser/OS locale) — no UI toggle.
      language: navigator.language || 'en-US',
      continuous: true,
    })
    setIsRecording(true)
  }

  const stopRecording = () => {
    SpeechRecognition.stopListening()
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

  return (
    <div
      style={{
        padding: '16px 20px',
        background: 'rgba(255, 255, 255, 0.55)',
        backdropFilter: 'blur(20px)',
        borderTop: '1px solid rgba(0, 0, 0, 0.06)',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      <style>{`
        .premium-textarea {
          resize: none !important;
          border: 1px solid rgba(0, 0, 0, 0.08) !important;
          background: rgba(255, 255, 255, 0.8) !important;
          border-radius: 12px !important;
          padding: 8px 12px !important;
          font-size: 14px !important;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
          font-family: inherit !important;
        }
        .premium-textarea:focus, .premium-textarea:hover {
          border-color: rgba(79, 70, 229, 0.4) !important;
          box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1) !important;
          background: #ffffff !important;
        }
        .premium-btn {
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
        }
        .premium-btn:hover:not(:disabled) {
          transform: scale(1.06);
        }
        .premium-btn:active:not(:disabled) {
          transform: scale(0.95);
        }
        @keyframes recording-pulsate {
          0% {
            box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4);
            transform: scale(1.0);
          }
          50% {
            box-shadow: 0 0 0 8px rgba(239, 68, 68, 0);
            transform: scale(1.08);
          }
          100% {
            box-shadow: 0 0 0 0 rgba(239, 68, 68, 0);
            transform: scale(1.0);
          }
        }
        .recording-active {
          animation: recording-pulsate 1.5s infinite cubic-bezier(0.4, 0, 0.2, 1) !important;
          background: rgba(239, 68, 68, 0.15) !important;
          border: 1px solid rgba(239, 68, 68, 0.3) !important;
        }
        @media (prefers-reduced-motion: reduce) {
          .recording-active {
            animation: none !important;
          }
        }
        .premium-send-btn {
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1) !important;
        }
        .premium-send-btn:hover:not(:disabled) {
          transform: scale(1.08);
          box-shadow: 0 4px 12px rgba(79, 70, 229, 0.35) !important;
          background: #4338ca !important;
        }
        .premium-send-btn:active:not(:disabled) {
          transform: scale(0.92);
        }
      `}</style>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px' }}>
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
          slotProps={{
            input: {
              disableUnderline: true,
              className: 'premium-textarea',
            },
          }}
          sx={{ flex: 1 }}
        />
        <Stack
          direction="row"
          spacing={0.75}
          sx={{ alignItems: 'center', marginBottom: '2px' }}
        >
          {speaking && (
            <IconButton
              onClick={onStopSpeaking}
              className="premium-btn"
              style={{
                background: 'rgba(239, 68, 68, 0.1)',
                width: '38px',
                height: '38px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title="Stop reading"
            >
              <Square size={15} style={{ color: '#ef4444' }} />
            </IconButton>
          )}
          <IconButton
            onClick={() => setSpeaker(!speaker)}
            className="premium-btn"
            style={{
              background: speaker
                ? 'rgba(16, 185, 129, 0.1)'
                : 'rgba(0, 0, 0, 0.04)',
              width: '38px',
              height: '38px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title={speaker ? 'Mute Speaker' : 'Unmute Speaker'}
          >
            {speaker ? (
              <Volume2 size={16} style={{ color: '#10b981' }} />
            ) : (
              <VolumeX size={16} style={{ color: 'rgba(0, 0, 0, 0.4)' }} />
            )}
          </IconButton>
          {!message && !isRecording && (
            <IconButton
              onClick={startRecording}
              disabled={
                isProcessing ||
                !browserSupportsSpeechRecognition ||
                !isMicrophoneAvailable
              }
              className="premium-btn"
              style={{
                background: 'rgba(79, 70, 229, 0.1)',
                width: '38px',
                height: '38px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title="Speak"
            >
              <Mic size={16} style={{ color: '#4f46e5' }} />
            </IconButton>
          )}
          {!message && isRecording && (
            <IconButton
              onClick={stopRecording}
              disabled={
                isProcessing ||
                !browserSupportsSpeechRecognition ||
                !isMicrophoneAvailable
              }
              className="premium-btn recording-active"
              style={{
                background: 'rgba(239, 68, 68, 0.1)',
                width: '38px',
                height: '38px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title="Stop Recording"
            >
              <Square size={14} style={{ color: '#ef4444' }} fill="#ef4444" />
            </IconButton>
          )}
          <IconButton
            disabled={isProcessing || !message.trim()}
            onClick={onMessageSend}
            className="premium-send-btn"
            style={{
              background: message.trim() ? '#4f46e5' : 'rgba(0, 0, 0, 0.04)',
              color: message.trim() ? '#ffffff' : 'rgba(0, 0, 0, 0.26)',
              width: '38px',
              height: '38px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title="Send"
          >
            <Send size={16} />
          </IconButton>
        </Stack>
      </div>
    </div>
  )
}
