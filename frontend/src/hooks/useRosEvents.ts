import { useEffect, useState } from 'react'
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
}

// Same host as the Django backend (VITE_BACKEND_HOST) — the polling_socket_node
// SocketIO server runs alongside the Flask bridge, not behind Django. Port is
// its own var since it's fixed at 5001 today, not the backend's :8000 (W4.4).
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
  // Monotonic count of completed ('end') block steps. blockStep alone can't
  // be counted by a consumer: the SocketIO transport here is polling (no
  // websocket server installed alongside polling_socket_node), so every
  // event emitted between two polls is delivered as one burst, and React
  // collapses the burst into a single re-render holding only the LAST event.
  // Counting effect firings therefore loses every intermediate 'end' — and
  // when the surviving event is a 'start', loses the update entirely. This
  // counter is incremented inside the handler with a functional update, so
  // it sees every event regardless of batching. Never reset here (a reset on
  // reconnect would look like backwards progress); consumers take their own
  // baseline at run start.
  const [blockStepsCompleted, setBlockStepsCompleted] = useState(0)
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
      // isRunning guard downstream, so it would stay up forever (W3.7).
      setHumanStep(null)
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
      if (data?.phase === 'end') setBlockStepsCompleted((n) => n + 1)
    })

    return () => {
      socket.disconnect()
    }
  }, [])

  return {
    gesture,
    objectDetection,
    humanStep,
    blockStep,
    blockStepsCompleted,
    connected,
  }
}
