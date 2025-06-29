import { ActionListType } from 'pages/actions/types'
import { LocationListType } from 'pages/locations/types'
import { ObjectListType } from 'pages/objects/types'
import { State } from 'blockly/core/serialization/blocks'
import BlocklyComponent, { Block, Field, Category } from './Blockly'

import { blocksColours } from './CustomBlocks'
import './CustomCategory'
import './CustomDragDropStyle.css'
import { AbstractStep } from 'pages/tasks/types'

interface CustomDragDropProps {
  dataLocations: LocationListType[]
  dataObjects: ObjectListType[]
  dataActions: ActionListType[]
  dataTask: State
  setTaskStructure: (task: AbstractStep[]) => void
  editingMode: boolean
}

export const CustomDragDrop = ({
  dataLocations,
  dataObjects,
  dataActions,
  dataTask,
  setTaskStructure,
  editingMode,
}: CustomDragDropProps) => {
  return (
    <BlocklyComponent
      dataTask={dataTask}
      editingMode={editingMode}
      setTaskStructure={setTaskStructure}
    >
      <Category name="Logic" colour={blocksColours.logics}>
        <Block type="repeat_block" />
        <Block type="loop_block" />
        <Block type="when_block" />
        <Block type="when_otherwise_block" />
        {/* <Block type="stop_when_block" />
        <Block type="do_when_block" /> */}
      </Category>
      <Category name="Events" colour={blocksColours.events}>
        {/* <Block type="detect_block" /> */}
        <Block type="sensor_signal_block" />
        <Block type="find_object_block" />
        <Block type="human_feedback_block" />
      </Category>
      <Category name="Steps" colour={blocksColours.steps}>
        <Block type="pick_block" />
        <Block type="place_block" />
        <Block type="processing_block" />
      </Category>
      <Category name="Objects" colour={blocksColours.objects}>
        {dataObjects.map((object) => (
          <Block type="object_block" key={object.id}>
            <Field name="name">{object.name}</Field>
            <data>
              {JSON.stringify({
                id: object.id,
                name: object.name,
                keywords: object.keywords?.join(',') || null,
              })}
            </data>
          </Block>
        ))}
      </Category>
      <Category name="Actions" colour={blocksColours.actions}>
        {dataActions.map((action) => (
          <Block type="action_block" key={action.id}>
            <Field name="name">{action.name}</Field>
            <data>
              {JSON.stringify({
                id: action.id,
                name: action.name,
                keywords: action.keywords?.join(',') || null,
              })}
            </data>
          </Block>
        ))}
      </Category>
      <Category name="Locations" colour={blocksColours.locations}>
        {dataLocations.map((location) => (
          <Block type="location_block" key={location.id} test="test">
            <Field name="name">{location.name}</Field>
            <data>
              {JSON.stringify({
                id: location.id,
                name: location.name,
                keywords: location.keywords?.join(',') || null,
              })}
            </data>
          </Block>
        ))}
      </Category>
    </BlocklyComponent>
  )
}
