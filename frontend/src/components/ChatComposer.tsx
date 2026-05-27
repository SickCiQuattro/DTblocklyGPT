import React from 'react';
import { Input, Button, Space } from 'antd';
import { Send, Mic, Square } from 'lucide-react';
import SpeechRecognition from 'react-speech-recognition';
import { formatTimeFrontend } from 'utils/date';
import dayjs from 'dayjs';
import { MethodHTTP, fetchApi } from 'services/api';
import { endpoints } from 'services/endpoints';
import { useDispatch } from 'react-redux';
import { setProposedTask } from 'store/reducers/proposal';
import { ChatResponse, MessageType, UserChatEnum, MessageTypeEnum } from 'pages/multimodal/utils';
import { CHATGPT_ERROR } from 'pages/multimodal/utils';
import { blocklyToAbstract, CustomBlock } from 'utils/blocklyParser';

interface ChatComposerProps {
  isProcessing: boolean;
  message: string;
  setMessage: (message: string) => void;
  isRecording: boolean;
  setIsRecording: (recording: boolean) => void;
  transcript: string;
  resetTranscript: () => void;
  browserSupportsSpeechRecognition: boolean;
  isMicrophoneAvailable: boolean;
  onMessageSend: () => void;
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
  const startRecording = () => {
    SpeechRecognition.startListening({
      language: 'en-GB',
      continuous: true,
    });
    setIsRecording(true);
  };

  const stopRecording = () => {
    SpeechRecognition.stopListening();
    setMessage(transcript);
    resetTranscript();
    setIsRecording(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onMessageSend();
    }
  };

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
      `}</style>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px' }}>
        <Input.TextArea
          placeholder={isRecording ? "Listening..." : "Type a message..."}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={isRecording}
          onKeyDown={handleKeyDown}
          autoSize={{ minRows: 1, maxRows: 6 }}
          className="premium-textarea"
          style={{ flex: 1 }}
        />
        <Space size={6} style={{ marginBottom: '2px' }}>
          {!message && !isRecording && (
            <Button
              icon={<Mic size={16} style={{ color: '#4f46e5' }} />}
              onClick={startRecording}
              disabled={
                isProcessing ||
                !browserSupportsSpeechRecognition ||
                !isMicrophoneAvailable
              }
              shape="circle"
              className="premium-btn"
              style={{
                background: 'rgba(79, 70, 229, 0.1)',
                border: 'none',
                width: '38px',
                height: '38px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title="Speak"
            />
          )}
          {!message && isRecording && (
            <Button
              icon={<Square size={14} style={{ color: '#ef4444' }} fill="#ef4444" />}
              onClick={stopRecording}
              disabled={
                isProcessing ||
                !browserSupportsSpeechRecognition ||
                !isMicrophoneAvailable
              }
              shape="circle"
              className="premium-btn"
              style={{
                background: 'rgba(239, 68, 68, 0.1)',
                border: 'none',
                width: '38px',
                height: '38px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title="Stop Recording"
            />
          )}
          <Button
            icon={<Send size={16} />}
            type="primary"
            disabled={isProcessing || !message.trim()}
            onClick={onMessageSend}
            shape="circle"
            className="premium-btn"
            style={{
              background: message.trim() ? '#4f46e5' : 'rgba(0, 0, 0, 0.04)',
              border: 'none',
              width: '38px',
              height: '38px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title="Send"
          />
        </Space>
      </div>
    </div>
  );
};