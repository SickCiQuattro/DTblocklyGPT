import { useCallback, useEffect, useState } from 'react'
import { io, Socket } from 'socket.io-client'

export interface ObjectDetection {
  detected: boolean
  detections: Array<{ class: string; confidence: number }>
}

export interface HumanStepStatus {
  status: 'started' | 'completed' | 'timeout' | 'notify' | 'error'
  description?: string
  condition?: string
  value?: string
  timeout?: number
  timestamp?: number
}

export interface BlockStepStatus {
  blockId: string
  blockType: string
  phase: 'start' | 'end'
  timestamp?: number
  /**
   * Present only while a Saved Task (macro) is running, re-announced on the
   * macro's own block as it advances (see _h_macro in simulate.py). The macro's
   * inner blocks are in another task's workspace and never appear on this
   * canvas, so this is the only signal of what it is doing.
   *
   * `macroStep`/`macroTotal` count TOP-LEVEL blocks, deliberately not a
   * percentage: a macro containing `repeat 5 times` runs far more steps than
   * its block count, so a fraction derived from the count would be wrong.
   */
  macroName?: string
  macroStep?: number
  macroTotal?: number
}

/** The Saved Task currently executing, or null. */
export interface MacroContext {
  /** Id of the macro block on the operator's canvas — what to keep highlighted. */
  blockId: string
  name: string
  step: number
  total: number
}

// Same host as the Django backend (VITE_BACKEND_HOST) — the polling_socket_node
// SocketIO server runs alongside the Flask bridge, not behind Django. Port is
// its own var since it's fixed at 5001 today, not the backend's :8000.
const SOCKET_URL =
  (import.meta.env.VITE_SOCKET_PROTOCOL || 'http://') +
  (import.meta.env.VITE_BACKEND_HOST || 'localhost') +
  (import.meta.env.VITE_SOCKET_PORT || ':5001')

export function useRosEvents() {
  const [gesture, setGesture] = useState<string>('NONE')
  const [objectDetection, setObjectDetection] = useState<ObjectDetection>({
    detected: false,
    detections: [],
  })
  const [humanStep, setHumanStep] = useState<HumanStepStatus | null>(null)
  const [blockStep, setBlockStep] = useState<BlockStepStatus | null>(null)
  // Tracked HERE, inside the socket handler, rather than in a consumer effect
  // watching `blockStep`. The transport is polling (no websocket server runs
  // alongside polling_socket_node), so every event emitted between two polls
  // arrives as one burst and React collapses the burst into a single
  // re-render holding only the LAST event — which during a Saved Task is
  // always one of its inner blocks, never the macro's own event. A consumer
  // watching `blockStep` therefore never saw the macro at all, so it neither
  // stayed highlighted nor showed its step count.
  const [macroContext, setMacroContext] = useState<MacroContext | null>(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const socket: Socket = io(SOCKET_URL, {
      transports: ['polling', 'websocket'],
      reconnectionDelay: 1000,
      reconnectionAttempts: 10,
    })

    socket.on('connect', () => setConnected(true))
    socket.on('disconnect', () => {
      setConnected(false)
      setBlockStep(null)
      // A stale 'timeout'/'error' humanStep otherwise survives past
      // disconnect and into the next run or task — its banner has no
      // isRunning guard downstream, so it would stay up forever.
      setHumanStep(null)
      setMacroContext(null)
    })

    socket.on('gesture_detected', (data: string) => {
      setGesture(data)
    })

    socket.on(
      'object_detected',
      (data: { detections: Array<{ class: string; confidence: number }> }) => {
        setObjectDetection({
          detected:
            Array.isArray(data?.detections) && data.detections.length > 0,
          detections: data?.detections ?? [],
        })
      },
    )

    socket.on('human_step', (data: HumanStepStatus) => {
      setHumanStep(data)
    })

    socket.on('block_step', (data: BlockStepStatus) => {
      setBlockStep(data)

      if (data?.macroName && data.macroTotal) {
        setMacroContext({
          blockId: data.blockId,
          name: data.macroName,
          step: data.macroStep ?? 0,
          total: data.macroTotal,
        })
      } else if (
        data?.phase === 'end' &&
        data.blockType === 'macro_task_block'
      ) {
        setMacroContext(null)
      }
    })

    return () => {
      socket.disconnect()
    }
  }, [])

  // A macro's context is cleared by its own 'end' event, which never arrives
  // when a run is stopped or aborted partway through a Saved Task. It then
  // survived into the NEXT run, where the consumer highlights whatever block
  // id it names and ignores every real event — so the run after a stopped
  // macro lit the wrong block and reported the old macro's step count for its
  // whole duration. The consumer resets this when a run ends.
  const resetMacroContext = useCallback(() => setMacroContext(null), [])

  return {
    gesture,
    objectDetection,
    humanStep,
    blockStep,
    macroContext,
    resetMacroContext,
    connected,
  }
}
