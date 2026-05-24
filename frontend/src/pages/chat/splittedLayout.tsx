import React, { useState } from 'react';
import { ChatDrawer } from 'components/ChatDrawer';

interface SplittedLayoutProps {
  speaker: boolean
  taskStructure: any // TaskChatStructure
  setTaskStructure: (taskStructure: any) => void
}

export const SplittedLayout = ({
  speaker,
  taskStructure,
  setTaskStructure,
}: SplittedLayoutProps) => {
  const [chatOpen, setChatOpen] = useState(true); // Start with chat open

  return (
    <div style={{ position: 'relative', height: '100%' }}>
      {/* Main workspace - will contain Blockly editor and simulation panel */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: chatOpen ? 300 : 0, // Adjust width when chat is open
          bottom: 0,
          padding: '16px',
          transition: 'right 0.3s ease',
        }}
      >
        <div style={{ height: '100%', background: '#f5f5f5', borderRadius: '8px' }}>
          <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
            Blockly workspace and simulation panel will be rendered here.
          </div>
        </div>
      </div>

      {/* Chat drawer */}
      <ChatDrawer
        open={chatOpen}
        onOpenChange={setChatOpen}
        speaker={speaker}
        setSpeaker={(s: boolean) => { /* We don't have a setter for speaker in the chat page, but we can pass a dummy */ }}
        isProcessing={false} // We don't have isProcessing in the chat page, but we can pass a dummy
        setIsProcessing={(b: boolean) => { /* dummy */ }}
        fineTunedModel="AAA"
        setFineTunedModel={(m: string) => { /* dummy */ }}
        fineTuningJobId="BBB"
        setFineTuningJobId={(j: string) => { /* dummy */ }}
        listMessages={[]} // We don't have listMessages in the chat page, but we can pass a dummy
        setListMessages={(m: any[]) => { /* dummy */ }}
        chatLog={[]}
        setChatLog={(l: any[]) => { /* dummy */ }}
        message=""
        setMessage={(m: string) => { /* dummy */ }}
        dataObjects={[]}
        dataLocations={[]}
        dataActions={[]}
        isRecording={false}
        setIsRecording={(r: boolean) => { /* dummy */ }}
        transcript=""
        resetTranscript={() => { /* dummy */ }}
        browserSupportsSpeechRecognition={false}
        isMicrophoneAvailable={false}
        taskId="" // We don't have taskId in the chat page, but we can get it from the URL? We'll pass a dummy for now.
        taskStructure={taskStructure}
        setTaskStructure={setTaskStructure}
        onApplyProposedTask={(proposedTask: any[]) => { /* dummy */ }}
        setNewChatResponse={(response: boolean) => { /* dummy */ }}
      />
    </div>
  );
};