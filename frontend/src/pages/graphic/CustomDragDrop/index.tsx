import { ActionListType } from 'pages/actions/types'
import { LocationListType } from 'pages/locations/types'
import { ObjectListType } from 'pages/objects/types'
import { State } from 'blockly/core/serialization/blocks'
import BlocklyComponent, { Block, Field, Category } from './Blockly'

import { blocksColours } from './CustomBlocks'
import './CustomCategory'
import './CustomDragDropStyle.css'

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
  return (
    <BlocklyComponent dataTask={dataTask}>
      <Category name="Logic / Control" colour={blocksColours.logicControl}>
        <Block type="repeat_block" />
        <Block type="loop_block" />
        <Block type="when_block" />
        <Block type="when_otherwise_block" />
      </Category>

      <Category name="Robot Actions" colour={blocksColours.robotActions}>
        <Block type="pick_block" />
        <Block type="place_block" />
        <Block type="processing_block" />
      </Category>

      <Category name="Human Actions" colour={blocksColours.humanActions}>
        <Block type="wait_for_human_block">
          <Field name="TASK_DESCRIPTION">insert component</Field>
        </Block>
      </Category>

      <Category
        name="Objects & Positions"
        colour={blocksColours.objectsPositions}
      >
        {dataObjects.map((object) => (
          <Block type="object_block" key={`object-${object.id}`}>
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

        {dataLocations.map((location) => (
          <Block type="location_block" key={`location-${location.id}`}>
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

        {dataActions.map((action) => (
          <Block type="action_block" key={`action-${action.id}`}>
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

      <Category
        name="Events / Conditions"
        colour={blocksColours.eventsConditions}
      >
        <Block type="sensor_signal_block" />
        <Block type="find_object_block" />
        <Block type="human_feedback_block" />
      </Category>

      {/* Macro-tasks: predefined sub-routines (future implementation) */}
      <Category name="Macro-tasks" colour={blocksColours.macroTasks}>
        {/* Blocks will be added in a later phase */}
      </Category>
    </BlocklyComponent>
  )
}
