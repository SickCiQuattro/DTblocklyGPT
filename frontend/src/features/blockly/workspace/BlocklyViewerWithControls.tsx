import { useCallback, useState } from 'react'
import { IconButton } from '@mui/material'
import * as Blockly from 'blockly/core'
import { Maximize, Minus, Plus } from 'lucide-react'

import { BlockState } from 'utils/blocklyTypes'

import { type BlockViewMode } from '../utils/useViewSettings'

import { BlocklyViewer } from './BlocklyViewer'
import { MODAL_VIEWER_CONFIG } from './workspaceConfig'
import '../styles/editor.css'

interface BlocklyViewerWithControlsProps {
  blockState: BlockState | BlockState[] | null
  height?: string
  startScale?: number
  autoCenter?: boolean
  autoFit?: boolean
  workspaceConfig?: Blockly.BlocklyOptions
  blockViewMode?: BlockViewMode
}

/**
 * Read-only Blockly viewer with custom zoom controls, used in rich modal previews.
 */
export const BlocklyViewerWithControls = ({
  blockState,
  height = '100%',
  startScale,
  autoCenter = true,
  autoFit = true,
  workspaceConfig = MODAL_VIEWER_CONFIG,
  blockViewMode = 'complete',
}: BlocklyViewerWithControlsProps) => {
  const [workspace, setWorkspace] = useState<Blockly.WorkspaceSvg | null>(null)

  const handleWorkspaceReady = useCallback(
    (readyWorkspace: Blockly.WorkspaceSvg | null) => {
      setWorkspace(readyWorkspace)
    },
    [],
  )

  const handleZoomIn = useCallback(() => {
    workspace?.zoomCenter(1)
  }, [workspace])

  const handleZoomOut = useCallback(() => {
    workspace?.zoomCenter(-1)
  }, [workspace])

  const handleZoomToFit = useCallback(() => {
    workspace?.zoomToFit()
  }, [workspace])

  return (
    <div style={{ position: 'relative', width: '100%', height }}>
      <BlocklyViewer
        blockState={blockState}
        height="100%"
        startScale={startScale}
        autoCenter={autoCenter}
        autoFit={autoFit}
        workspaceConfig={workspaceConfig}
        blockViewMode={blockViewMode}
        onWorkspaceReady={handleWorkspaceReady}
      />

      <div className="workspace-controls-overlay" aria-hidden={false}>
        <div className="workspace-controls-group workspace-controls-group--bottom-right">
          <IconButton
            className="workspace-control-button"
            size="small"
            onClick={handleZoomIn}
            disabled={!workspace}
            aria-label="Zoom in"
          >
            <Plus size={18} />
          </IconButton>

          <IconButton
            className="workspace-control-button"
            size="small"
            onClick={handleZoomOut}
            disabled={!workspace}
            aria-label="Zoom out"
          >
            <Minus size={18} />
          </IconButton>

          <IconButton
            className="workspace-control-button"
            size="small"
            onClick={handleZoomToFit}
            disabled={!workspace}
            aria-label="Fit to screen"
          >
            <Maximize size={18} />
          </IconButton>
        </div>
      </div>
    </div>
  )
}

export type { BlocklyViewerWithControlsProps }
