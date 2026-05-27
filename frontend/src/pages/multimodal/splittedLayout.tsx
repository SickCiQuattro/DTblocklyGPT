import React, { useState, useMemo, useEffect } from 'react'
import { useMediaQuery } from '@mui/material'
import {
  Edit3,
  Save,
  X,
  Volume2,
  VolumeX,
  Play,
  MessageSquare,
} from 'lucide-react'
import { useDispatch } from 'react-redux'
import { toast } from 'react-toastify'
import { useParams } from 'react-router-dom'

import { BlocklyEditor, getBlocklyStructure } from 'features/blockly'
import { useViewSettings } from 'features/blockly/utils/useViewSettings'
import { LocationListType } from 'pages/locations/types'
import { ObjectListType } from 'pages/objects/types'
import { ActionListType } from 'pages/actions/types'
import { AbstractStep, TaskType, TaskDetailType } from 'pages/tasks/types'
import { BlockState as State } from 'utils/blocklyTypes'
import {
  abstractToBlockly,
  blocklyToAbstract,
  CustomBlock,
} from 'utils/blocklyParser'
import { Palette } from 'themes/palette'
import { fetchApi, MethodHTTP } from 'services/api'
import { endpoints } from 'services/endpoints'
import { MessageText } from 'utils/messages'
import { toggleEditMode } from 'store/reducers/task'

import { ChatDrawer } from 'components/ChatDrawer'
import { DigitalTwinPanel } from 'components/DigitalTwinPanel'
import { INITIAL_MESSAGE_1, MessageType } from './utils'
import { useSpeechRecognition } from 'react-speech-recognition'
import { RightPanel } from './rightPanel'

interface SplittedLayoutProps {
  dataLocations: LocationListType[]
  dataObjects: ObjectListType[]
  dataActions: ActionListType[]
  dataMacros: TaskType[]
  macroDetailsById?: Record<number, TaskDetailType>
  currentTaskId?: number
  abstractTask: AbstractStep[]
  backFunction: () => void
}

const isBlockState = (value: unknown): value is State =>
  typeof value === 'object' &&
  value !== null &&
  'type' in value &&
  typeof (value as { type?: unknown }).type === 'string'

export const SplittedLayout = ({
  dataLocations,
  dataObjects,
  dataActions,
  dataMacros,
  macroDetailsById = {},
  currentTaskId,
  abstractTask,
  backFunction,
}: SplittedLayoutProps) => {
  const isBigScreen = useMediaQuery('(min-width: 1700px)')
  const height = isBigScreen ? '70vh' : '60vh'
  const [taskStructure, setTaskStructure] = useState<AbstractStep[] | null>(
    abstractTask,
  )
  const [editingMode, setEditingMode] = useState<boolean>(true)
  const [newChatResponse, setNewChatResponse] = useState<boolean>(false)
  const [speaker, setSpeaker] = React.useState(false)
  const themePalette = Palette('light')
  const dispatch = useDispatch()
  const { id } = useParams()

  const { viewSettings, updateViewSettings, resetViewSettings } =
    useViewSettings()

  const [chatOpen, setChatOpen] = useState<boolean>(true)
  const [simOpen, setSimOpen] = useState<boolean>(false)
  const [isProcessing, setIsProcessing] = useState<boolean>(false)
  const [fineTunedModel, setFineTunedModel] = useState<string>('')
  const [fineTuningJobId, setFineTuningJobId] = useState<string>('')
  const [listMessages, setListMessages] = useState<MessageType[]>([
    INITIAL_MESSAGE_1,
  ])
  const [chatLog, setChatLog] = useState<any[]>([])
  const [message, setMessage] = useState<string>('')
  const [isRecording, setIsRecording] = useState<boolean>(false)


  const {
    transcript,
    resetTranscript,
    browserSupportsSpeechRecognition,
    isMicrophoneAvailable,
  } = useSpeechRecognition()

  const handleSave = () => {
    const blocklyTaskStructure = getBlocklyStructure()
    const mainBlock = Array.isArray(blocklyTaskStructure)
      ? blocklyTaskStructure.find((b: any) => b.type === 'when_start') ||
        blocklyTaskStructure[0]
      : blocklyTaskStructure
    const abstractTask = blocklyToAbstract(mainBlock as CustomBlock)

    void fetchApi({
      url: endpoints.graphic.saveGraphicTask,
      method: MethodHTTP.PUT,
      body: { taskStructure: blocklyTaskStructure, id },
    }).then(() => {
      toast.success(MessageText.success)
      void dispatch(toggleEditMode())
      backFunction()
    })
  }

  const initialDataTask = useMemo(() => {
    if (!abstractTask) return null

    const convertedTask = abstractToBlockly(
      abstractTask,
      dataObjects,
      dataLocations,
      dataActions,
    )
    return isBlockState(convertedTask) ? convertedTask : null
  }, [abstractTask, dataObjects, dataLocations, dataActions])

  const [editorDataTask, setEditorDataTask] = useState<State | null>(null)
  const [pendingChatTask, setPendingChatTask] = useState<State | null>(null)

  // Initialize editorDataTask once when initialDataTask becomes available
  useEffect(() => {
    if (initialDataTask && !editorDataTask) {
      setEditorDataTask(initialDataTask)
    }
  }, [initialDataTask, editorDataTask])

  return (
    <div>
      <div style={{ marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
        {!editingMode && (
          <button
            onClick={() => setEditingMode(true)}
            title="Edit"
            style={{
              background: 'rgba(237, 137, 54, 0.1)',
              border: '1px solid rgba(237, 137, 54, 0.2)',
              borderRadius: '8px',
              padding: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(237, 137, 54, 0.2)';
              e.currentTarget.style.transform = 'scale(1.05)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(237, 137, 54, 0.1)';
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            <Edit3 size={20} style={{ color: themePalette.palette.warning.main }} />
          </button>
        )}
        {editingMode && (
          <button
            onClick={handleSave}
            title="Save"
            style={{
              background: 'rgba(79, 70, 229, 0.1)',
              border: '1px solid rgba(79, 70, 229, 0.2)',
              borderRadius: '8px',
              padding: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(79, 70, 229, 0.2)';
              e.currentTarget.style.transform = 'scale(1.05)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(79, 70, 229, 0.1)';
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            <Save size={20} style={{ color: themePalette.palette.primary.main }} />
          </button>
        )}
        <button
          onClick={() => {
            if (editingMode) {
              setEditingMode(false)
              setTaskStructure(abstractTask)
            }
          }}
          disabled={!editingMode}
          title="Cancel"
          style={{
            background: editingMode ? 'rgba(239, 68, 68, 0.1)' : 'rgba(0, 0, 0, 0.02)',
            border: editingMode ? '1px solid rgba(239, 68, 68, 0.2)' : '1px solid rgba(0, 0, 0, 0.05)',
            borderRadius: '8px',
            padding: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: editingMode ? 'pointer' : 'not-allowed',
            opacity: editingMode ? 1 : 0.5,
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => {
            if (editingMode) {
              e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)';
              e.currentTarget.style.transform = 'scale(1.05)';
            }
          }}
          onMouseLeave={(e) => {
            if (editingMode) {
              e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)';
              e.currentTarget.style.transform = 'scale(1)';
            }
          }}
        >
          <X
            size={20}
            style={{
              color: editingMode
                ? themePalette.palette.error.main
                : themePalette.palette.grey[300],
            }}
          />
        </button>

        {speaker ? (
          <button
            onClick={() => {
              if (editingMode) setSpeaker(false)
            }}
            disabled={!editingMode}
            title="Mute Speaker"
            style={{
              background: editingMode ? 'rgba(16, 185, 129, 0.1)' : 'rgba(0, 0, 0, 0.02)',
              border: editingMode ? '1px solid rgba(16, 185, 129, 0.2)' : '1px solid rgba(0, 0, 0, 0.05)',
              borderRadius: '8px',
              padding: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: editingMode ? 'pointer' : 'not-allowed',
              opacity: editingMode ? 1 : 0.5,
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              if (editingMode) {
                e.currentTarget.style.background = 'rgba(16, 185, 129, 0.2)';
                e.currentTarget.style.transform = 'scale(1.05)';
              }
            }}
            onMouseLeave={(e) => {
              if (editingMode) {
                e.currentTarget.style.background = 'rgba(16, 185, 129, 0.1)';
                e.currentTarget.style.transform = 'scale(1)';
              }
            }}
          >
            <Volume2 size={20} style={{ color: themePalette.palette.success.main }} />
          </button>
        ) : (
          <button
            onClick={() => {
              if (editingMode) setSpeaker(true)
            }}
            disabled={!editingMode}
            title="Unmute Speaker"
            style={{
              background: editingMode ? 'rgba(239, 68, 68, 0.1)' : 'rgba(0, 0, 0, 0.02)',
              border: editingMode ? '1px solid rgba(239, 68, 68, 0.2)' : '1px solid rgba(0, 0, 0, 0.05)',
              borderRadius: '8px',
              padding: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: editingMode ? 'pointer' : 'not-allowed',
              opacity: editingMode ? 1 : 0.5,
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              if (editingMode) {
                e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)';
                e.currentTarget.style.transform = 'scale(1.05)';
              }
            }}
            onMouseLeave={(e) => {
              if (editingMode) {
                e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)';
                e.currentTarget.style.transform = 'scale(1)';
              }
            }}
          >
            <VolumeX size={20} style={{ color: themePalette.palette.error.main }} />
          </button>
        )}


        {editingMode && (
          <button
            onClick={() => setSimOpen(!simOpen)}
            title="Toggle Simulation Panel"
            style={{
              background: simOpen ? 'rgba(16, 185, 129, 0.1)' : 'rgba(79, 70, 229, 0.1)',
              border: simOpen ? '1px solid rgba(16, 185, 129, 0.2)' : '1px solid rgba(79, 70, 229, 0.2)',
              borderRadius: '8px',
              padding: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = simOpen ? 'rgba(16, 185, 129, 0.2)' : 'rgba(79, 70, 229, 0.2)';
              e.currentTarget.style.transform = 'scale(1.05)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = simOpen ? 'rgba(16, 185, 129, 0.1)' : 'rgba(79, 70, 229, 0.1)';
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            <Play
              size={20}
              style={{
                color: simOpen
                  ? themePalette.palette.success.main
                  : themePalette.palette.primary.main,
              }}
            />
          </button>
        )}
        {editingMode && !chatOpen && (
          <button
            onClick={() => setChatOpen(true)}
            title="Open Chat"
            style={{
              background: 'rgba(79, 70, 229, 0.1)',
              border: '1px solid rgba(79, 70, 229, 0.2)',
              borderRadius: '8px',
              padding: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(79, 70, 229, 0.2)';
              e.currentTarget.style.transform = 'scale(1.05)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(79, 70, 229, 0.1)';
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            <MessageSquare size={20} style={{ color: themePalette.palette.primary.main }} />
          </button>
        )}
      </div>
      <div style={{ display: 'flex', height }}>
        {editingMode && (
          <ChatDrawer
            open={chatOpen}
            onOpenChange={setChatOpen}
            speaker={speaker}
            setSpeaker={setSpeaker}
            isProcessing={isProcessing}
            setIsProcessing={setIsProcessing}
            fineTunedModel={fineTunedModel}
            setFineTunedModel={setFineTunedModel}
            fineTuningJobId={fineTuningJobId}
            setFineTuningJobId={setFineTuningJobId}
            listMessages={listMessages}
            setListMessages={setListMessages}
            chatLog={chatLog}
            setChatLog={setChatLog}
            message={message}
            setMessage={setMessage}
            dataObjects={dataObjects}
            dataLocations={dataLocations}
            dataActions={dataActions}
            isRecording={isRecording}
            setIsRecording={setIsRecording}
            transcript={transcript}
            resetTranscript={resetTranscript}
            browserSupportsSpeechRecognition={browserSupportsSpeechRecognition}
            isMicrophoneAvailable={isMicrophoneAvailable}
            taskId={id || ''}
            taskStructure={taskStructure}
            setTaskStructure={setTaskStructure}
            onApplyProposedTask={(proposed) => {
              setTaskStructure(proposed)
              const converted = abstractToBlockly(
                proposed,
                dataObjects,
                dataLocations,
                dataActions,
              )
              if (isBlockState(converted)) {
                setPendingChatTask(converted)
              }
              setNewChatResponse(true)
            }}
            setNewChatResponse={setNewChatResponse}
          />
        )}
        <BlocklyEditor
          dataLocations={dataLocations}
          dataObjects={dataObjects}
          dataActions={dataActions}
          dataMacros={dataMacros}
          macroDetailsById={macroDetailsById}
          currentTaskId={currentTaskId}
          dataTask={editorDataTask}
          pendingExternalTask={pendingChatTask}
          editMode={editingMode}
          applyExternalTaskState={newChatResponse}
          onExternalTaskStateApplied={() => {
            setNewChatResponse(false)
            setPendingChatTask(null)
          }}
          onTaskStructureChange={setTaskStructure}
          blockViewMode={viewSettings.blockViewMode}
          deleteConfirmMode={viewSettings.deleteConfirmMode}
          showStartBlock={viewSettings.showStartBlock}
          viewSettings={viewSettings}
          onViewSettingsChange={updateViewSettings}
          onResetViewSettings={resetViewSettings}
        />
        {simOpen && (
          <div style={{ width: '33.33%', marginRight: '1rem', marginLeft: '1rem' }}>
            <DigitalTwinPanel
              taskId={id || ''}
              onClose={() => setSimOpen(false)}
            />
          </div>
        )}
        <RightPanel dataTask={taskStructure} />
      </div>
    </div>
  )
}
