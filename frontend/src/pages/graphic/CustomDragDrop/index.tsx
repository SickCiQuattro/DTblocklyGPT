import * as Blockly from 'blockly/core'
import { useEffect, useRef } from 'react'
import { ActionListType } from 'pages/actions/types'
import { LocationListType } from 'pages/locations/types'
import { ObjectListType } from 'pages/objects/types'
import { State } from 'blockly/core/serialization/blocks'
import BlocklyComponent from './Blockly'

import { CustomToolbox, ToolboxBlockItem } from './CustomToolbox'
import './CustomCategory'
import './CustomDragDropStyle.css'

const DRAG_THRESHOLD_PX = 5

interface CustomDragDropProps {
  dataLocations: LocationListType[]
  dataObjects: ObjectListType[]
  dataActions: ActionListType[]
  dataTask: State
}

export const CustomDragDrop = ({
  dataLocations,
  dataObjects,
  dataActions,
  dataTask,
}: CustomDragDropProps) => {
  const workspaceRef = useRef<Blockly.WorkspaceSvg | null>(null)
  const pendingDragCleanupRef = useRef<(() => void) | null>(null)

  const startSyntheticBlockDrag = (
    pointerEvent: PointerEvent,
    sourceElement: HTMLDivElement,
    item: ToolboxBlockItem,
    workspace: Blockly.WorkspaceSvg,
  ) => {
    const hasFields = !!item.fields && Object.keys(item.fields).length > 0
    const hasData = typeof item.data === 'string' && item.data.length > 0

    const blockState: State = {
      type: item.type,
      ...(hasFields ? { fields: item.fields } : {}),
      ...(hasData ? { data: item.data } : {}),
    }

    try {
      // Raggruppa la creazione e il drag nello stesso evento di undo
      Blockly.Events.setGroup(true)

      // 1. Instanzia e renderizza il blocco
      const block = Blockly.serialization.blocks.append(
        blockState,
        workspace,
      ) as Blockly.BlockSvg

      block.initSvg()
      block.render()

      // 2. Calcola e posiziona il blocco
      const screenCoordinates = new Blockly.utils.Coordinate(
        pointerEvent.clientX,
        pointerEvent.clientY,
      )
      const workspaceCoords = Blockly.utils.svgMath.screenToWsCoordinates(
        workspace,
        screenCoordinates,
      )
      block.moveTo(
        new Blockly.utils.Coordinate(
          workspaceCoords.x - 20,
          workspaceCoords.y - 20,
        ),
      )

      // 3. SYNTHETIC EVENT ROUTING
      if (sourceElement.hasPointerCapture(pointerEvent.pointerId)) {
        sourceElement.releasePointerCapture(pointerEvent.pointerId)
      }

      const svgRoot = block.getSvgRoot()
      const syntheticEvent = new PointerEvent('pointerdown', {
        clientX: pointerEvent.clientX,
        clientY: pointerEvent.clientY,
        pointerId: pointerEvent.pointerId,
        button: 0,
        bubbles: true,
        cancelable: true,
        pointerType: pointerEvent.pointerType,
        isPrimary: pointerEvent.isPrimary,
      })

      svgRoot.dispatchEvent(syntheticEvent)
    } catch (error) {
      console.error('Errore nel proxy della Gesture Blockly:', error)
    } finally {
      Blockly.Events.setGroup(false)
    }
  }

  useEffect(() => {
    return () => {
      pendingDragCleanupRef.current?.()
      pendingDragCleanupRef.current = null
    }
  }, [])

  const handleBlockPointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    item: ToolboxBlockItem,
  ) => {
    // Solo clic primario (tasto sinistro)
    if (e.button !== 0) return

    const workspace = workspaceRef.current
    if (!workspace) return

    if (workspace.options.readOnly) return

    // Previene comportamenti di default del browser (selezione testo, drag HTML nativo)
    e.preventDefault()

    // Chiude eventuali menù Blockly aperti
    workspace.hideChaff()

    // Pulisce eventuali listener di un drag precedente incompleto.
    pendingDragCleanupRef.current?.()
    pendingDragCleanupRef.current = null

    const startX = e.clientX
    const startY = e.clientY
    const pointerId = e.pointerId
    const sourceElement = e.currentTarget

    const cleanup = () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerEnd)
      window.removeEventListener('pointercancel', onPointerEnd)

      if (pendingDragCleanupRef.current === cleanup) {
        pendingDragCleanupRef.current = null
      }
    }

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return

      const distance = Math.hypot(
        moveEvent.clientX - startX,
        moveEvent.clientY - startY,
      )

      if (distance < DRAG_THRESHOLD_PX) {
        return
      }

      cleanup()
      startSyntheticBlockDrag(moveEvent, sourceElement, item, workspace)
    }

    const onPointerEnd = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== pointerId) return
      // Se arriviamo qui prima della soglia, era un semplice click: nessuna creazione.
      cleanup()
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerEnd)
    window.addEventListener('pointercancel', onPointerEnd)

    pendingDragCleanupRef.current = cleanup
  }

  return (
    <div className="custom-dragdrop-layout">
      <CustomToolbox
        dataObjects={dataObjects}
        dataLocations={dataLocations}
        dataActions={dataActions}
        onBlockPointerDown={handleBlockPointerDown}
      />
      <div className="custom-dragdrop-workspace-wrapper">
        <BlocklyComponent
          dataTask={dataTask}
          onWorkspaceReady={(workspace) => {
            workspaceRef.current = workspace
          }}
        />
      </div>
    </div>
  )
}
