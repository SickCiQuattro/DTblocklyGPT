import { useEffect, useMemo, useRef } from 'react'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'

import { BlockState } from 'utils/blocklyTypes'

import { isValidBlockState } from '../utils/serialization'
import { type BlockViewMode } from '../utils/useViewSettings'
import { applyBlockViewMode } from '../utils/viewModePresentation'

import { READONLY_WORKSPACE_CONFIG } from './workspaceConfig'

interface BlocklyViewerProps {
  blockState: BlockState | BlockState[] | null
  height?: string
  startScale?: number
  autoCenter?: boolean
  autoFit?: boolean
  workspaceConfig?: Blockly.BlocklyOptions
  blockViewMode?: BlockViewMode
  onWorkspaceReady?: (workspace: Blockly.WorkspaceSvg | null) => void
}

/**
 * Lightweight read-only Blockly renderer used in previews and modal inspections.
 */
export const BlocklyViewer = ({
  blockState,
  height = '100%',
  startScale,
  autoCenter = true,
  autoFit = false,
  workspaceConfig,
  blockViewMode = 'complete',
  onWorkspaceReady,
}: BlocklyViewerProps) => {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const workspaceRef = useRef<Blockly.WorkspaceSvg | null>(null)

  const injectConfig = useMemo<Blockly.BlocklyOptions>(() => {
    const baseConfig = workspaceConfig ?? READONLY_WORKSPACE_CONFIG

    if (typeof startScale !== 'number') {
      return baseConfig
    }

    const baseZoom = baseConfig.zoom ?? {}

    return {
      ...baseConfig,
      zoom: {
        ...baseZoom,
        startScale,
      },
    }
  }, [startScale, workspaceConfig])

  useEffect(() => {
    const container = mountRef.current
    if (!container) {
      return
    }

    container.innerHTML = ''
    const workspace = Blockly.inject(container, injectConfig)
    workspaceRef.current = workspace
    onWorkspaceReady?.(workspace)

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
      onWorkspaceReady?.(null)
    }
  }, [injectConfig, onWorkspaceReady])

  useEffect(() => {
    const workspace = workspaceRef.current
    if (!workspace) {
      return
    }

    workspace.clear()

    if (!isValidBlockState(blockState)) {
      return
    }

    if (Array.isArray(blockState)) {
      blockState.forEach((block) => {
        Blockly.serialization.blocks.append({ ...block }, workspace)
      })
    } else {
      Blockly.serialization.blocks.append({ ...blockState }, workspace)
    }

    applyBlockViewMode(workspace, blockViewMode)

    window.requestAnimationFrame(() => {
      if (!workspaceRef.current) {
        return
      }

      Blockly.svgResize(workspaceRef.current)
      if (autoFit) {
        workspaceRef.current.zoomToFit()
      }
      if (autoCenter) {
        workspaceRef.current.scrollCenter()
      }
    })
  }, [autoCenter, autoFit, blockState, blockViewMode])

  return <div ref={mountRef} style={{ width: '100%', height }} />
}

export type { BlocklyViewerProps }
