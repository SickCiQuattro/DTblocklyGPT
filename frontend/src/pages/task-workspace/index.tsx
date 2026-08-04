import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react'
import {
  useParams,
  useNavigate,
  useSearchParams,
  useLocation,
} from 'react-router-dom'
import { useDispatch } from 'react-redux'
import { Box, CircularProgress, Typography } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import useSWR, { useSWRConfig } from 'swr'
import dayjs from 'dayjs'
import { toast } from 'react-toastify'
import * as Blockly from 'blockly/core'
import { Blocks } from 'lucide-react'

import { useAppSelector } from 'store/reducers'
import {
  setActiveTask,
  setSaving,
  setLastSaved,
  triggerSave,
  triggerRename,
  triggerDiscard,
  triggerSavedFlash,
  setSaveError,
  setWorkspaceReady,
  setConformanceIssues,
  setHasUnsavedEdits,
  toggleChat,
  toggleSim,
} from 'store/reducers/task'
import { resetSimulation } from 'store/reducers/simulation'
import { openDrawer } from 'store/reducers/menu'
import { BlocklyEditor, getBlocklyStructure } from 'features/blockly'
import { useViewSettings } from 'features/blockly/utils/useViewSettings'
import { useConformance } from 'features/blockly/utils/useConformance'
import {
  abstractToBlockly,
  blocklyToAbstractAll,
  CustomBlock,
} from 'utils/blocklyParser'
import { endpoints } from 'services/endpoints'
import { fetchApi, MethodHTTP } from 'services/api'
import { ObjectListType } from 'pages/objects/types'
import { LocationListType } from 'pages/locations/types'
import { ActionListType } from 'pages/actions/types'
import {
  TaskType,
  TaskDetailType,
  AbstractStep,
  TaskStatus,
} from 'pages/tasks/types'
import { BlockState as State } from 'utils/blocklyTypes'
import { useDocumentTitle } from 'hooks/useDocumentTitle'
import { getFromLocalStorage, LocalStorageKey } from 'utils/localStorageUtils'

import { ChatThread } from '../../components/ChatThread'
import { DigitalTwinPanel } from '../../components/DigitalTwinPanel'
import { BottomPanel } from '../../components/BottomPanel'
import { StatusBar } from '../../components/StatusBar'

const isBlockState = (value: unknown): value is State =>
  typeof value === 'object' &&
  value !== null &&
  'type' in value &&
  typeof (value as { type?: unknown }).type === 'string'

export const UnifiedWorkspace = () => {
  const theme = useTheme()
  const { id } = useParams()
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const location = useLocation()
  const { mutate } = useSWRConfig()
  const [searchParams] = useSearchParams()
  const typeParam = searchParams.get('type')
  // The Tasks list "Run on the real robot" button lands here with this state
  // instead of a query param — it's a one-shot instruction, not a bookmarkable
  // URL, so it's consumed once and doesn't need to survive a refresh.
  const navState = location.state as {
    autoOpenRobot?: boolean
    executionTarget?: 'sim' | 'real'
  } | null
  const initialExecutionTarget = navState?.executionTarget

  // Redux layout/sync states
  const chatOpen = useAppSelector((state) => state.task.chatOpen)
  const simOpen = useAppSelector((state) => state.task.simOpen)
  const codeOpen = useAppSelector((state) => state.task.codeOpen)
  const activeTaskName = useAppSelector((state) => state.task.activeTaskName)
  useDocumentTitle(activeTaskName || 'Task')
  const activeTaskStatus = useAppSelector(
    (state) => state.task.activeTaskStatus,
  )
  const isSaving = useAppSelector((state) => state.task.isSaving)
  const saveTriggered = useAppSelector((state) => state.task.saveTriggered)
  const discardTriggered = useAppSelector(
    (state) => state.task.discardTriggered,
  )
  const renameTriggered = useAppSelector((state) => state.task.renameTriggered)
  const isReadOnly = useAppSelector((state) => state.task.isReadOnly)
  const chatPosition =
    useAppSelector((state) => state.task.chatPosition) || 'right'

  // Same source/shape as listTasks.tsx's canManage — one place per-file that
  // reads the logged-in user's id from localStorage, kept in sync deliberately.
  const storedUser: unknown = getFromLocalStorage(LocalStorageKey.USER)
  const currentUserId =
    typeof storedUser === 'object' &&
    storedUser !== null &&
    'id' in storedUser &&
    (typeof storedUser.id === 'string' || typeof storedUser.id === 'number')
      ? String(storedUser.id)
      : null

  // Sync chat sidebar visibility based on homepage URL query parameters
  useEffect(() => {
    if (typeParam === 'graphic') {
      if (chatOpen) {
        dispatch(toggleChat())
      }
    } else if (typeParam === 'chat' || typeParam === 'multimodal') {
      if (!chatOpen) {
        dispatch(toggleChat())
      }
    }
  }, [typeParam, chatOpen, dispatch])

  // Sync the robot panel to this visit's intent, once per mount. simOpen is
  // a single global Redux flag with no per-task scope, so without this it
  // leaks open from whichever task it was last toggled on into the next
  // workspace you visit (including a brand-new task) — open only on the
  // explicit "Run on the real robot" card action, force closed otherwise.
  // Guarded by a ref, not just a simOpen check, so closing the panel
  // afterwards doesn't reopen/reclose it on an unrelated re-render.
  const autoOpenRobotHandledRef = useRef(false)
  useEffect(() => {
    if (autoOpenRobotHandledRef.current) return
    autoOpenRobotHandledRef.current = true
    const shouldBeOpen = !!navState?.autoOpenRobot
    if (simOpen !== shouldBeOpen) dispatch(toggleSim())
    // simulation is likewise a single global slice with no per-task scope —
    // without this, navigating away mid-run and opening a different task
    // inherits isRunning/message from whatever ran on the last one.
    dispatch(resetSimulation())
    // eslint-disable-next-line @eslint-react/exhaustive-deps
  }, [])

  // Blockly View Settings
  const { viewSettings, updateViewSettings, resetViewSettings } =
    useViewSettings()

  // Focus mode: collapse the nav rail and the Blockly toolbox while a run is
  // in flight, then restore exactly what was open before. Ref-guarded so a
  // re-render mid-run doesn't re-snapshot an already-collapsed layout.
  const drawerOpen = useAppSelector((state) => state.menu.drawerOpen)
  const isSimulationRunning = useAppSelector(
    (state) => state.simulation.isRunning,
  )
  const preRunLayoutRef = useRef<{
    drawerOpen: boolean
    toolboxCollapsed: boolean
  } | null>(null)
  useEffect(() => {
    if (isSimulationRunning && !preRunLayoutRef.current) {
      preRunLayoutRef.current = {
        drawerOpen,
        toolboxCollapsed: viewSettings.toolboxCollapsed,
      }
      if (drawerOpen) dispatch(openDrawer(false))
      if (!viewSettings.toolboxCollapsed) {
        updateViewSettings({ toolboxCollapsed: true })
      }
    } else if (!isSimulationRunning && preRunLayoutRef.current) {
      const snapshot = preRunLayoutRef.current
      preRunLayoutRef.current = null
      dispatch(openDrawer(snapshot.drawerOpen))
      updateViewSettings({ toolboxCollapsed: snapshot.toolboxCollapsed })
    }
    // eslint-disable-next-line @eslint-react/exhaustive-deps
  }, [isSimulationRunning])

  // Chat interaction states
  const [newChatResponse, setNewChatResponse] = useState(false)
  const [pendingChatTask, setPendingChatTask] = useState<State | null>(null)
  const [taskStructure, setTaskStructure] = useState<any[]>([])
  const [workspace, setWorkspace] = useState<Blockly.WorkspaceSvg | null>(null)

  // SWR queries for libraries
  const { data: dataObjects = [], isLoading: isLoadingObjects } = useSWR<
    ObjectListType[],
    Error
  >({
    url: endpoints.graphic.objectsGraphic,
  })
  const { data: dataActions = [], isLoading: isLoadingActions } = useSWR<
    ActionListType[],
    Error
  >({
    url: endpoints.graphic.actionsGraphic,
  })
  const { data: dataLocations = [], isLoading: isLoadingLocations } = useSWR<
    LocationListType[],
    Error
  >({
    url: endpoints.graphic.locationsGraphic,
  })
  const { data: dataMacros = [] } = useSWR<TaskType[], Error>({
    url: endpoints.graphic.macroList,
  })

  const currentTaskId = id ? Number(id) : -1

  // Filter out the current task to prevent infinite recursion/self-reference cycles
  const filteredMacros = useMemo(
    () => dataMacros.filter((m) => m.id !== currentTaskId),
    [dataMacros, currentTaskId],
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
            owner: m.owner,
            owner__username: m.owner__username,
            status: m.status,
            task_type: m.task_type,
            signature: m.signature,
            code: m.published_workspace ?? null,
          } satisfies TaskDetailType,
        ]),
      ),
    [filteredMacros],
  )

  // SWR query for specific task
  const {
    data: taskData,
    isLoading: isTaskLoading,
    mutate: mutateTask,
  } = useSWR<TaskDetailType, Error>(
    id ? { url: endpoints.home.libraries.task, body: { id } } : null,
  )

  // Set active task info in Redux on load
  useEffect(() => {
    if (taskData) {
      // Read is legitimate for owner-or-shared (task_detail's GET), but every
      // write endpoint is owner-only — a task that loaded fine can still be
      // read-only. taskData.owner is undefined only if task_detail's response
      // predates this field (shouldn't happen post-deploy, but don't treat a
      // missing owner as "not mine" and lock out the actual owner).
      const taskIsReadOnly =
        taskData.owner !== undefined &&
        currentUserId !== null &&
        String(taskData.owner) !== currentUserId &&
        taskData.shared
      dispatch(
        setActiveTask({
          id: taskData.id.toString(),
          name: taskData.name,
          status: taskData.status,
          isReadOnly: taskIsReadOnly,
          ownerUsername: taskData.owner__username ?? null,
        }),
      )
      // lastSaved is a single global Redux flag with no per-task scope, so
      // without seeding it here it either stays null (StatusBar wrongly
      // shows "Draft not saved" on a freshly-opened, untouched task) or
      // leaks a previous task's save time into this one when navigating
      // task-to-task without a remount. Seed it from the record's own
      // last_modified so it reflects reality until the next real save.
      if (taskData.last_modified) {
        dispatch(setLastSaved(dayjs(taskData.last_modified).format('HH:mm:ss')))
      }
      // Same per-visit leak as lastSaved: loading a task must not inherit
      // "unsaved edits" from whatever was open before. The deserialize below
      // happens inside Blockly.Events.disable()/enable() (BlocklyWorkspace.tsx),
      // so it never fires the structural-change listener that would set this.
      dispatch(setHasUnsavedEdits(false))
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
          const abstract = blocklyToAbstractAll(
            taskData.code as unknown as CustomBlock[] | null,
          )
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
        }),
      )
      // Same leak as above, the other direction: a brand-new task has never
      // been saved, but lastSaved would still carry whatever the previously
      // open task last saved at if not cleared here.
      dispatch(setLastSaved(null))
      dispatch(setHasUnsavedEdits(false))
      setTaskStructure([])
    }
  }, [taskData, id, dispatch, currentUserId])

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
      dataActions,
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
  const { isReady, issues, formattedIssues } = useConformance(
    workspace,
    viewSettings.blockViewMode === 'complete',
    {
      currentTaskId: currentTaskId === -1 ? null : currentTaskId,
      macroDetailsById,
    },
  )
  const isCanvasEmpty = issues.some((i) => i.type === 'EMPTY_WORKSPACE')

  // Sync workspace readiness + why-not-ready to Redux — Header/index.tsx
  // shows the issue count next to Save without needing the live workspace.
  useEffect(() => {
    dispatch(setWorkspaceReady(isReady))
    dispatch(setConformanceIssues(formattedIssues))
  }, [isReady, formattedIssues, dispatch])

  // Save / Publish pipeline matching the original Graphic logic
  const saveTaskToBackend = useCallback(
    async (currentName: string, isPublish: boolean, isAutoSave = false) => {
      if (isSaving) return
      dispatch(setSaving(true))

      const visualStructure = getBlocklyStructure()

      try {
        let targetId = id ? Number(id) : null

        if (!targetId) {
          // If we don't have an ID, we must FIRST create the task row via metadata POST endpoint.
          // rethrowOn: [400] — a name collision (e.g. the default "New Task"
          // reused by a second untitled task) otherwise resolved here with
          // the backend's {nameAlreadyExists: true} payload instead of an
          // id, which the check below couldn't tell apart from any other
          // failure and reported as a generic connection problem.
          const res = await fetchApi<any, any>({
            url: endpoints.home.libraries.task,
            method: MethodHTTP.POST,
            rethrowOn: [400],
            body: {
              id: -1,
              name: currentName,
              // No canned description — every task used to get the literal
              // text "Visual task program" as its subtitle everywhere
              // (task list, Check for problems). Leaving it unset (backend
              // defaults to null) lets the card omit the subtitle entirely
              // until the operator writes a real one.
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
              }),
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

        if (isAutoSave) {
          // The resulting status is fully predictable from save_draft's own
          // rule (task_lifecycle.py: draft/published_with_draft stay put,
          // published -> published_with_draft) — no need to round-trip for
          // it. A full mutateTask() here (autosave fires every ~2s while
          // typing) re-fetched the task on every keystroke pause, which
          // re-ran the "on load" effect above and clobbered the in-progress
          // taskStructure/isReadOnly/hasUnsavedEdits state with a server
          // echo of what was just saved — the visible "workspace refreshes
          // on its own" symptom.
          const newStatus: TaskStatus = isPublish
            ? 'published'
            : taskData?.status === 'published'
              ? 'published_with_draft'
              : (taskData?.status ?? 'draft')
          dispatch(
            setActiveTask({
              // targetId is non-null here: the branch above either read it
              // from an existing `id` or throws before falling through.
              id: targetId!.toString(),
              name: currentName,
              status: newStatus,
            }),
          )
        } else {
          // Invalidate and sync SWR cache and status in real-time
          const updatedTask = await mutateTask()
          if (updatedTask) {
            dispatch(
              setActiveTask({
                id: updatedTask.id.toString(),
                name: updatedTask.name,
                status: updatedTask.status,
              }),
            )
          }
          void mutate({ url: endpoints.home.libraries.tasks })
        }
        dispatch(setLastSaved(dayjs().format('HH:mm:ss')))
        dispatch(triggerSavedFlash(true))
        dispatch(setSaveError(false))
        // The just-saved structure is now what would run — Run can trust
        // activeTaskStatus/workspaceReady again (see setHasUnsavedEdits(true)
        // in handleTaskStructureChange below for why this was ever false).
        dispatch(setHasUnsavedEdits(false))

        if (!id && targetId) {
          // If it was a newly created task, navigate to the correct URL path
          navigate(`/task/${targetId}`, { replace: true })
        }

        if (!isAutoSave) {
          toast.success(
            isPublish
              ? 'Task saved and published successfully'
              : 'Draft saved successfully',
          )
        }
      } catch (err) {
        console.error('Failed to save task:', err)
        // Autosave failures show no toast (would fire every 2s while the
        // connection is down) — this flag is the only persistent signal.
        dispatch(setSaveError(true))
        // A 400 (e.g. the name collision above) already got its own
        // specific, accurate toast from fetchApi — a second generic
        // "Failed to save draft" on top of it just buries the real reason.
        const alreadyToasted = err instanceof Error && err.name === '400'
        if (!isAutoSave && !alreadyToasted) {
          toast.error(
            isPublish ? 'Failed to publish task' : 'Failed to save draft',
          )
        }
      } finally {
        dispatch(setSaving(false))
      }
    },
    [id, isSaving, taskData, dispatch, navigate, mutate, mutateTask],
  )

  // Debounced auto-save handler (2 seconds)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleTaskStructureChange = (
    newStructure: import('pages/tasks/types').ASTBranch[] | null,
  ) => {
    // Belt-and-suspenders: BlocklyEditor's editMode={!isReadOnly} should
    // already stop the user from producing structural changes at all on a
    // shared-not-mine task, but never let an edit reach the 2s autosave
    // debounce regardless — the write endpoint would 404 "Task not found"
    // (owner-only by design) and surface as a confusing generic save error.
    if (isReadOnly) return
    const structureArray = newStructure || []
    setTaskStructure(structureArray)
    // Set synchronously, not after the debounce fires — a task that WAS
    // published still reads activeTaskStatus === 'published' for up to 2s
    // (longer if the operator keeps editing, since each change re-arms this
    // timer) after a real edit. Without this, Run stays the filled primary
    // action during that whole window and would run the stale published
    // version while the screen shows the new one.
    dispatch(setHasUnsavedEdits(true))

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
      // Header's Save button is already disabled when isReadOnly, but Ctrl/Cmd+S
      // below dispatches unconditionally — stop it here too before it 404s.
      if (isReadOnly) return

      // Clear any pending debounced auto-save timeout to prevent race condition status downgrades
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }

      void saveTaskToBackend(activeTaskName, isReady, false)
    }
  }, [
    saveTriggered,
    activeTaskName,
    isReady,
    saveTaskToBackend,
    dispatch,
    isReadOnly,
  ])

  // Ctrl/Cmd+S → same save trigger the header Save button dispatches.
  // preventDefault blocks the browser's native "Save Page As" dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault()
        dispatch(triggerSave(true))
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [dispatch])

  // Rename-only trigger listener — a header title edit updates just the
  // name metadata. It must never go through saveTaskToBackend/triggerSave,
  // which also (re)publishes the whole workspace whenever it happens to
  // pass conformance — a rename shouldn't have that side effect.
  useEffect(() => {
    if (renameTriggered) {
      dispatch(triggerRename(false)) // Reset immediately to prevent multiple triggers
      if (isReadOnly) return
      if (id && taskData && taskData.name !== activeTaskName) {
        fetchApi({
          url: endpoints.home.libraries.task,
          method: MethodHTTP.PUT,
          body: { ...taskData, name: activeTaskName },
        })
          .then(async () => {
            const updatedTask = await mutateTask()
            if (updatedTask) {
              dispatch(
                setActiveTask({
                  id: updatedTask.id.toString(),
                  name: updatedTask.name,
                  status: updatedTask.status,
                }),
              )
            }
            void mutate({ url: endpoints.home.libraries.tasks })
            dispatch(setLastSaved(dayjs().format('HH:mm:ss')))
            dispatch(triggerSavedFlash(true))
          })
          .catch((err) => {
            console.error('Failed to rename task:', err)
            toast.error('Failed to rename task')
          })
      }
    }
  }, [
    renameTriggered,
    id,
    taskData,
    activeTaskName,
    dispatch,
    mutateTask,
    mutate,
    isReadOnly,
  ])

  // Discard draft trigger listener
  useEffect(() => {
    if (discardTriggered) {
      dispatch(triggerDiscard(false)) // Reset immediately to prevent multiple triggers
      if (isReadOnly) return
      if (id) {
        dispatch(setSaving(true))
        fetchApi({
          url: endpoints.task.discardDraft,
          method: MethodHTTP.POST,
          body: { id: Number(id) },
        })
          .then(async () => {
            toast.success('Draft discarded successfully')
            // Wait for the refetch to land before clearing editorDataTask —
            // the repopulate effect (below) only fills in initialDataTask
            // when editorDataTask is null, so clearing it first (before
            // taskData/initialDataTask actually reflect the published
            // version) reloads the same stale draft right back in.
            await mutateTask()
            setEditorDataTask(null) // Force workspace reload from the newly fetched published state
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
  }, [discardTriggered, id, dispatch, mutateTask, mutate, isReadOnly])

  const isLoading =
    isLoadingObjects ||
    isLoadingActions ||
    isLoadingLocations ||
    (id && isTaskLoading && !taskData)

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
          Loading your task…
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
          gap: '12px',
          p: '12px',
          bgcolor: 'background.default',
          boxSizing: 'border-box',
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
          {/* Empty canvas explains itself instead of just sitting blank. Why
              "Save" isn't "Save & Publish" yet (useConformance's issues)
              shows next to Save in the header instead of here — see
              Header/index.tsx. */}
          {isCanvasEmpty && (
            <Box
              sx={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                zIndex: 1,
                pointerEvents: 'none',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '10px',
                textAlign: 'center',
              }}
            >
              <Blocks size={32} color={theme.palette.slate[400]} />
              <Typography variant="body2" color="text.secondary">
                Drag a block from the toolbox to start,
                <br />
                or ask Copilot to build it for you.
              </Typography>
            </Box>
          )}
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
            editMode={!isReadOnly}
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
          workspace={workspace}
          onClose={() => dispatch(toggleChat())}
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
              setNewChatResponse(true)
            } else {
              // abstractToBlockly returns `{}` (no `type`) when every step in
              // the proposal used a type it doesn't recognize — previously
              // this fell through silently: setNewChatResponse(true) still
              // fired, but with no valid pendingExternalTask the apply effect
              // in BlocklyWorkspace.tsx no-ops, so Replace looked like it did
              // nothing with zero console error.
              console.error(
                'Chat proposal could not be converted to blocks',
                proposed,
              )
              toast.error(
                "Couldn't apply these blocks — the proposal used a step type the workspace doesn't support.",
              )
            }
          }}
        />
      </Box>

      {/* Digital Twin Panel slide-in (Step 8) */}
      <DigitalTwinPanel
        taskId={id || ''}
        taskStatus={taskData?.status}
        workspace={workspace}
        initialExecutionTarget={initialExecutionTarget}
      />

      {/* JSON Viewer Bottom Panel (Step 6) */}
      <BottomPanel data={taskStructure} open={codeOpen} />

      {/* StatusBar (Step 6) */}
      <StatusBar />
    </Box>
  )
}

export default UnifiedWorkspace
