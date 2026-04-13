import { useEffect, useMemo, useRef } from 'react'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'

import { BlockState } from 'utils/blocklyTypes'

import { isValidBlockState } from '../utils/serialization'
import { READONLY_WORKSPACE_CONFIG } from './workspaceConfig'

interface BlocklyViewerProps {
  blockState: BlockState | null
  height?: string
  startScale?: number
  autoCenter?: boolean
}

/**
 * Lightweight read-only Blockly renderer used in previews and modal inspections.
 */
export const BlocklyViewer = ({
  blockState,
  height = '100%',
  startScale,
  autoCenter = true,
}: BlocklyViewerProps) => {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const workspaceRef = useRef<Blockly.WorkspaceSvg | null>(null)

  const injectConfig = useMemo<Blockly.BlocklyOptions>(() => {
    if (typeof startScale !== 'number') {
      return READONLY_WORKSPACE_CONFIG
    }

    return {
      ...READONLY_WORKSPACE_CONFIG,
      zoom: {
        ...READONLY_WORKSPACE_CONFIG.zoom,
        startScale,
      },
    }
  }, [startScale])

  useEffect(() => {
    const container = mountRef.current
    if (!container) {
      return
    }

    container.innerHTML = ''
    const workspace = Blockly.inject(container, injectConfig)
    workspaceRef.current = workspace

    const resizeObserver = new ResizeObserver(() => {
      if (workspaceRef.current) {
        Blockly.svgResize(workspaceRef.current)
      }
    })
    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      workspace.dispose()
      workspaceRef.current = null
    }
  }, [injectConfig])

  useEffect(() => {
    const workspace = workspaceRef.current
    if (!workspace) {
      return
    }

    workspace.clear()

    if (!isValidBlockState(blockState)) {
      return
    }

    Blockly.serialization.blocks.append({ ...blockState }, workspace)

    window.requestAnimationFrame(() => {
      if (!workspaceRef.current) {
        return
      }

      Blockly.svgResize(workspaceRef.current)
      if (autoCenter) {
        workspaceRef.current.scrollCenter()
      }
    })
  }, [autoCenter, blockState])

  return <div ref={mountRef} style={{ width: '100%', height }} />
}

export type { BlocklyViewerProps }
