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

const SOCKET_URL = 'http://localhost:5001'

export function useRosEvents() {
  const [gesture, setGesture] = useState<string>('NONE')
  const [objectDetection, setObjectDetection] = useState<ObjectDetection>({
    detected: false,
    detections: [],
  })
  const [humanStep, setHumanStep] = useState<HumanStepStatus | null>(null)
  const [blockStep, setBlockStep] = useState<BlockStepStatus | null>(null)
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
    })

    return () => {
      socket.disconnect()
    }
  }, [])

  return { gesture, objectDetection, humanStep, blockStep, connected }
}
