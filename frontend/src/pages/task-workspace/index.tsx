import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useDispatch } from 'react-redux'
import { Box, CircularProgress, Typography } from '@mui/material'
import useSWR, { useSWRConfig } from 'swr'
import dayjs from 'dayjs'
import { toast } from 'react-toastify'

import { useAppSelector } from 'store/reducers'
import {
  setActiveTask,
  setSaving,
  setLastSaved,
  triggerSave,
  triggerDiscard,
  setWorkspaceReady,
  toggleChat,
} from 'store/reducers/task'
import { BlocklyEditor, getBlocklyStructure } from 'features/blockly'
import { useViewSettings } from 'features/blockly/utils/useViewSettings'
import { useConformance } from 'features/blockly/utils/useConformance'
import * as Blockly from 'blockly/core'
import { abstractToBlockly, blocklyToAbstractAll, CustomBlock } from 'utils/blocklyParser'
import { endpoints } from 'services/endpoints'
import { fetchApi, MethodHTTP } from 'services/api'
import { ChatThread } from '../../components/ChatThread'
import { DigitalTwinPanel } from '../../components/DigitalTwinPanel'
import { BottomPanel } from '../../components/BottomPanel'
import { StatusBar } from '../../components/StatusBar'
import { ObjectListType } from 'pages/objects/types'
import { LocationListType } from 'pages/locations/types'
import { ActionListType } from 'pages/actions/types'
import { TaskType, TaskDetailType, AbstractStep } from 'pages/tasks/types'
import { BlockState as State } from 'utils/blocklyTypes'

const isBlockState = (value: unknown): value is State =>
  typeof value === 'object' &&
  value !== null &&
  'type' in value &&
  typeof (value as { type?: unknown }).type === 'string'

export const UnifiedWorkspace = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const { mutate } = useSWRConfig()

  // Redux layout/sync states
  const chatOpen = useAppSelector((state) => state.task.chatOpen)
  const simOpen = useAppSelector((state) => state.task.simOpen)
  const codeOpen = useAppSelector((state) => state.task.codeOpen)
  const activeTaskName = useAppSelector((state) => state.task.activeTaskName)
  const activeTaskStatus = useAppSelector((state) => state.task.activeTaskStatus)
  const isSaving = useAppSelector((state) => state.task.isSaving)
  const saveTriggered = useAppSelector((state) => state.task.saveTriggered)
  const discardTriggered = useAppSelector((state) => state.task.discardTriggered)
  const chatPosition = useAppSelector((state) => state.task.chatPosition) || 'right'

  // Blockly View Settings
  const { viewSettings, updateViewSettings, resetViewSettings } = useViewSettings()

  // Chat interaction states
  const [newChatResponse, setNewChatResponse] = useState(false)
  const [pendingChatTask, setPendingChatTask] = useState<State | null>(null)
  const [taskStructure, setTaskStructure] = useState<any[]>([])
  const [workspace, setWorkspace] = useState<Blockly.WorkspaceSvg | null>(null)

  // SWR queries for libraries
  const { data: dataObjects = [], isLoading: isLoadingObjects } = useSWR<ObjectListType[], Error>({
    url: endpoints.graphic.objectsGraphic,
  })
  const { data: dataActions = [], isLoading: isLoadingActions } = useSWR<ActionListType[], Error>({
    url: endpoints.graphic.actionsGraphic,
  })
  const { data: dataLocations = [], isLoading: isLoadingLocations } = useSWR<LocationListType[], Error>({
    url: endpoints.graphic.locationsGraphic,
  })
  const { data: dataMacros = [] } = useSWR<TaskType[], Error>({
    url: endpoints.graphic.macroList,
  })

  const currentTaskId = id ? Number(id) : -1

  // Filter out the current task to prevent infinite recursion/self-reference cycles
  const filteredMacros = useMemo(
    () => dataMacros.filter((m) => m.id !== currentTaskId),
    [dataMacros, currentTaskId]
  )

  // Derive macroDetailsById mapping (published_workspace maps to code) for block explosion and tooltips preview
  const macroDetailsById = useMemo(
    (): Record<number, TaskDetailType> =>
      Object.fromEntries(
        filteredMacros.map((m) => [
          m.id,
          {
            id: m.id,
            name: m.name,
            description: m.description,
            shared: m.shared,
            status: m.status,
            task_type: m.task_type,
            signature: m.signature,
            code: m.published_workspace ?? null,
          } satisfies TaskDetailType,
        ])
      ),
    [filteredMacros]
  )

  // SWR query for specific task
  const { data: taskData, isLoading: isTaskLoading, mutate: mutateTask } = useSWR<TaskDetailType, Error>(
    id ? { url: endpoints.home.libraries.task, body: { id } } : null
  )

  // Set active task info in Redux on load
  useEffect(() => {
    if (taskData) {
      dispatch(
        setActiveTask({
          id: taskData.id.toString(),
          name: taskData.name,
          status: taskData.status,
        })
      )
      if (taskData.code) {
        const isVisual = (item: any): boolean => {
          if (typeof item !== 'object' || item === null) return false
          const t = item.type
          if (typeof t !== 'string') return false
          return t.endsWith('_block') || t.startsWith('when_')
        }

        const hasVisualBlock = Array.isArray(taskData.code)
          ? taskData.code.some(isVisual)
          : isVisual(taskData.code)

        if (hasVisualBlock) {
          const abstract = blocklyToAbstractAll(taskData.code as unknown as CustomBlock[] | null)
          setTaskStructure(abstract || [])
        } else {
          setTaskStructure(taskData.code as unknown as any[])
        }
      }
    } else if (!id) {
      dispatch(
        setActiveTask({
          id: null,
          name: 'New Task',
          status: 'draft',
        })
      )
      setTaskStructure([])
    }
  }, [taskData, id, dispatch])

  // Convert initial backend structure to Blockly block structure
  const initialDataTask = useMemo(() => {
    if (!taskData || !taskData.code) return null

    const isVisual = (item: any): boolean => {
      if (typeof item !== 'object' || item === null) return false
      const t = item.type
      if (typeof t !== 'string') return false
      return t.endsWith('_block') || t.startsWith('when_')
    }

    const hasVisualBlock = Array.isArray(taskData.code)
      ? taskData.code.some(isVisual)
      : isVisual(taskData.code)

    if (hasVisualBlock) {
      return taskData.code as unknown as State
    }

    const converted = abstractToBlockly(
      taskData.code as unknown as any[],
      dataObjects,
      dataLocations,
      dataActions
    )
    return isBlockState(converted) ? converted : null
  }, [taskData, dataObjects, dataLocations, dataActions])

  const [editorDataTask, setEditorDataTask] = useState<State | null>(null)

  useEffect(() => {
    if (initialDataTask && !editorDataTask) {
      setEditorDataTask(initialDataTask)
    }
  }, [initialDataTask, editorDataTask])

  // Conformance tracking
  const { isReady } = useConformance(workspace)

  // Sync workspace readiness to Redux
  useEffect(() => {
    dispatch(setWorkspaceReady(isReady))
  }, [isReady, dispatch])

  // Save / Publish pipeline matching the original Graphic logic
  const saveTaskToBackend = useCallback(
    async (currentName: string, isPublish: boolean, isAutoSave = false) => {
      if (isSaving) return
      dispatch(setSaving(true))

      const visualStructure = getBlocklyStructure()

      try {
        let targetId = id ? Number(id) : null

        if (!targetId) {
          // If we don't have an ID, we must FIRST create the task row via metadata POST endpoint
          const res = await fetchApi<any, any>({
            url: endpoints.home.libraries.task,
            method: MethodHTTP.POST,
            body: {
              id: -1,
              name: currentName,
              description: 'Visual task program',
              shared: false,
              task_type: 'task',
              status: 'draft',
            },
          })

          if (res && res.id) {
            targetId = res.id
            dispatch(
              setActiveTask({
                id: res.id.toString(),
                name: currentName,
                status: 'draft',
              })
            )
          } else {
            throw new Error('Failed to create task record')
          }
        }

        // Now save the visual workspace structure to the appropriate endpoint based on isPublish!
        if (isPublish) {
          await fetchApi({
            url: endpoints.task.publish,
            method: MethodHTTP.POST,
            body: {
              id: targetId,
              taskStructure: visualStructure,
            },
          })
        } else {
          await fetchApi({
            url: endpoints.task.saveDraft,
            method: MethodHTTP.PUT,
            body: {
              id: targetId,
              taskStructure: visualStructure,
            },
          })
        }

        // If the task name was edited, update task metadata name
        if (taskData && taskData.name !== currentName) {
          await fetchApi({
            url: endpoints.home.libraries.task,
            method: MethodHTTP.PUT,
            body: {
              ...taskData,
              name: currentName,
            },
          })
        }

        // Invalidate and sync SWR cache and status in real-time
        const updatedTask = await mutateTask()
        if (updatedTask) {
          dispatch(
            setActiveTask({
              id: updatedTask.id.toString(),
              name: updatedTask.name,
              status: updatedTask.status,
            })
          )
        }
        void mutate({ url: endpoints.home.libraries.tasks })
        dispatch(setLastSaved(dayjs().format('HH:mm:ss')))

        if (!id && targetId) {
          // If it was a newly created task, navigate to the correct URL path
          navigate(`/task/${targetId}`, { replace: true })
        }

        if (!isAutoSave) {
          toast.success(isPublish ? 'Task saved and published successfully' : 'Draft saved successfully')
        }
      } catch (err) {
        console.error('Failed to save task:', err)
        if (!isAutoSave) {
          toast.error(isPublish ? 'Failed to publish task' : 'Failed to save draft')
        }
      } finally {
        dispatch(setSaving(false))
      }
    },
    [id, isSaving, taskData, dispatch, navigate, mutate, mutateTask]
  )

  // Debounced auto-save handler (2 seconds)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleTaskStructureChange = (newStructure: import('pages/tasks/types').ASTBranch[] | null) => {
    const structureArray = newStructure || []
    setTaskStructure(structureArray)

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    saveTimeoutRef.current = setTimeout(() => {
      void saveTaskToBackend(activeTaskName, false, true)
    }, 2000)
  }

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [])

  // Manual save trigger listener
  useEffect(() => {
    if (saveTriggered) {
      dispatch(triggerSave(false)) // Reset immediately to prevent multiple triggers

      // Clear any pending debounced auto-save timeout to prevent race condition status downgrades
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }

      void saveTaskToBackend(activeTaskName, isReady, false)
    }
  }, [saveTriggered, activeTaskName, isReady, saveTaskToBackend, dispatch])

  // Discard draft trigger listener
  useEffect(() => {
    if (discardTriggered) {
      dispatch(triggerDiscard(false)) // Reset immediately to prevent multiple triggers
      if (id) {
        dispatch(setSaving(true))
        fetchApi({
          url: endpoints.task.discardDraft,
          method: MethodHTTP.POST,
          body: { id: Number(id) },
        })
          .then(() => {
            toast.success('Draft discarded successfully')
            setEditorDataTask(null) // Force workspace reload from the newly fetched published state
            void mutateTask()
            void mutate({ url: endpoints.home.libraries.tasks })
          })
          .catch((err) => {
            console.error('Failed to discard draft:', err)
            toast.error('Failed to discard draft')
          })
          .finally(() => {
            dispatch(setSaving(false))
          })
      }
    }
  }, [discardTriggered, id, dispatch, mutateTask, mutate])

  const isLoading = isLoadingObjects || isLoadingActions || isLoadingLocations || (id && isTaskLoading && !taskData)

  if (isLoading) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: 'calc(100vh - 56px)',
          gap: 2,
        }}
      >
        <CircularProgress color="primary" />
        <Typography variant="body2" color="text.secondary">
          Loading Visual Programming Workspace...
        </Typography>
      </Box>
    )
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 56px)',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'row',
          flex: 1,
          overflow: 'hidden',
          width: '100%',
        }}
      >
        {/* Blockly visual workspace */}
        <Box
          sx={{
            flex: 1,
            height: '100%',
            position: 'relative',
            transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            width: simOpen ? 'calc(100% - 35vw)' : '100%',
            order: chatPosition === 'left' ? 2 : 1,
          }}
        >
          <BlocklyEditor
            onWorkspaceReady={setWorkspace}
            dataLocations={dataLocations}
            dataObjects={dataObjects}
            dataActions={dataActions}
            dataMacros={filteredMacros}
            macroDetailsById={macroDetailsById}
            currentTaskId={currentTaskId}
            dataTask={editorDataTask}
            pendingExternalTask={pendingChatTask}
            editMode={true}
            applyExternalTaskState={newChatResponse}
            onExternalTaskStateApplied={() => {
              setNewChatResponse(false)
              setPendingChatTask(null)
            }}
            onTaskStructureChange={handleTaskStructureChange}
            blockViewMode={viewSettings.blockViewMode}
            deleteConfirmMode={viewSettings.deleteConfirmMode}
            showStartBlock={viewSettings.showStartBlock}
            viewSettings={viewSettings}
            onViewSettingsChange={updateViewSettings}
            onResetViewSettings={resetViewSettings}
          />
        </Box>

        {/* AI Chat Copilot sidebar */}
        <ChatThread
          taskId={id || null}
          taskStructure={taskStructure}
          onClose={() => dispatch(toggleChat())}
          onApplyProposedTask={(proposed) => {
            setTaskStructure(proposed)
            const converted = abstractToBlockly(
              proposed,
              dataObjects,
              dataLocations,
              dataActions
            )
            if (isBlockState(converted)) {
              setPendingChatTask(converted)
            }
            setNewChatResponse(true)
          }}
        />
      </Box>

      {/* Digital Twin Panel slide-in (Step 8) */}
      <DigitalTwinPanel taskId={id || ''} />

      {/* JSON Viewer Bottom Panel (Step 6) */}
      <BottomPanel data={taskStructure} open={codeOpen} />

      {/* StatusBar (Step 6) */}
      <StatusBar />
    </Box>
  )
}

export default UnifiedWorkspace
