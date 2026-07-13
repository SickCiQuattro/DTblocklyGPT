import axios from 'axios'
import Cookies from 'js-cookie'
import { useCallback, useEffect, useRef, useState } from 'react'

import { endpoints } from 'services/endpoints'

export interface WebcamDetection {
  class: string
  confidence: number
  color?: string
}

export interface WebcamDevice {
  deviceId: string
  label: string
}

export interface WebcamVisionState {
  videoRef: React.RefObject<HTMLVideoElement | null>
  attachVideo: (el: HTMLVideoElement | null) => void
  gesture: string
  detections: WebcamDetection[]
  active: boolean
  error: string | null
  activeLabel: string
  selectedDeviceId: string
  devices: WebcamDevice[]
  start: (deviceId?: string) => Promise<void>
  stop: () => void
  selectDevice: (deviceId: string) => Promise<void>
  detectObjects: boolean
  setDetectObjects: (enabled: boolean) => void
}

const CAPTURE_INTERVAL_MS = 300

export function useWebcamVision(): WebcamVisionState {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const activeRef = useRef(false)
  const inFlightRef = useRef(false)
  const detectObjectsRef = useRef(false)

  const [gesture, setGesture] = useState<string>('NONE')
  const [detections, setDetections] = useState<WebcamDetection[]>([])
  const [detectObjects, setDetectObjectsState] = useState(false)
  const [active, setActive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeLabel, setActiveLabel] = useState<string>('')
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('')
  const [devices, setDevices] = useState<WebcamDevice[]>([])

  const captureAndSend = useCallback(async () => {
    // Always re-arm while active, even on the skip paths below — the <video>
    // element may not be mounted yet (e.g. the run-time self-view only mounts
    // once the gesture step starts, seconds after the webcam itself started).
    // Returning without rescheduling used to kill the capture loop permanently
    // in exactly that window, so no frames were ever sent for the gesture step.
    const rearm = () => {
      if (activeRef.current) setTimeout(captureAndSend, CAPTURE_INTERVAL_MS)
    }

    if (!activeRef.current || inFlightRef.current) return
    const video = videoRef.current
    if (!video || video.readyState < 2) {
      rearm()
      return
    }

    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas')
    }
    const canvas = canvasRef.current
    canvas.width = video.videoWidth || 640
    canvas.height = video.videoHeight || 480
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      rearm()
      return
    }

    // Mirror horizontally so gesture engine sees correct orientation
    ctx.translate(canvas.width, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(video, 0, 0)
    ctx.setTransform(1, 0, 0, 1, 0, 0)

    const b64 = canvas.toDataURL('image/jpeg', 0.7).split(',')[1]

    inFlightRef.current = true
    try {
      const resp = await axios.post(
        endpoints.vision.frame,
        { frame: b64, detect_objects: detectObjectsRef.current },
        {
          headers: {
            'X-CSRFToken': Cookies.get('csrftoken') ?? '',
            'Content-Type': 'application/json',
          },
          withCredentials: true,
        },
      )
      const result = resp.data
      if (result && activeRef.current) {
        setGesture(result.gesture ?? 'NONE')
        setDetections(result.detections ?? [])
      }
    } catch {
      // ignore transient errors
    } finally {
      inFlightRef.current = false
      rearm()
    }
  }, [])

  // Callback ref: attach video element and bind stream if already available
  const attachVideo = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el
    if (el && streamRef.current) {
      el.srcObject = streamRef.current
      el.play().catch((e: Error) => setError(`Camera play error: ${e.message}`))
    }
  }, [])

  const start = useCallback(
    async (deviceId?: string) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(
          'Camera unavailable — secure context required (use http://localhost:3000)',
        )
        return
      }
      setError(null)
      try {
        const videoConstraints: MediaTrackConstraints = {
          width: { ideal: 640 },
          height: { ideal: 480 },
        }
        if (deviceId) videoConstraints.deviceId = { exact: deviceId }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
        })
        streamRef.current = stream

        const track = stream.getVideoTracks()[0]
        const label = track?.label ?? 'Unknown camera'
        const actualDeviceId = track?.getSettings().deviceId ?? deviceId ?? ''
        setActiveLabel(label)
        setSelectedDeviceId(actualDeviceId)

        const el = videoRef.current
        if (el) {
          el.srcObject = stream
          el.play().catch((e: Error) =>
            setError(`Camera play error: ${e.message}`),
          )
        }

        activeRef.current = true
        setActive(true)

        // Watchdog: camera "connected" but video black (e.g. Continuity Camera
        // locked). Only a mounted <video> that stays black is a real fault —
        // the element may simply not be mounted yet at the 3s mark (e.g. the
        // run-time self-view only mounts once a gesture step starts, which
        // can be well after the webcam itself started), and that is not an
        // error.
        setTimeout(() => {
          if (!activeRef.current) return
          const v = videoRef.current
          if (v && v.videoWidth === 0) {
            setError(
              `No video from "${label}". Camera may be locked or in use elsewhere. ` +
                `Select a different device from the picker below.`,
            )
          }
        }, 3000)

        // Enumerate after getUserMedia — labels now populated
        const allDevices = await navigator.mediaDevices.enumerateDevices()
        const videoDevices = allDevices
          .filter((d) => d.kind === 'videoinput')
          .map((d) => ({
            deviceId: d.deviceId,
            label: d.label || d.deviceId.slice(0, 12),
          }))
        setDevices(videoDevices)

        setTimeout(captureAndSend, 500)
      } catch (err: any) {
        setError(err?.message ?? 'Camera access denied')
        setActive(false)
      }
    },
    [captureAndSend],
  )

  const stop = useCallback(() => {
    activeRef.current = false
    setActive(false)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setGesture('NONE')
    setDetections([])
    setActiveLabel('')
    setSelectedDeviceId('')
  }, [])

  const setDetectObjects = useCallback((enabled: boolean) => {
    detectObjectsRef.current = enabled
    setDetectObjectsState(enabled)
    if (!enabled) setDetections([])
  }, [])

  const selectDevice = useCallback(
    async (deviceId: string) => {
      activeRef.current = false
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
        streamRef.current = null
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null
      }
      setActive(false)
      await start(deviceId)
    },
    [start],
  )

  useEffect(() => {
    return () => {
      activeRef.current = false
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  return {
    videoRef,
    attachVideo,
    gesture,
    detections,
    active,
    error,
    activeLabel,
    selectedDeviceId,
    devices,
    start,
    stop,
    selectDevice,
    detectObjects,
    setDetectObjects,
  }
}
