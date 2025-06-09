import {
  AbstractTask,
  AbstractStep,
  AbstractObject,
  AbstractLocation,
  AbstractAction,
  AbstractRobot,
} from '../pages/tasks/types'

export type AnalyzerIssue = {
  type: 'error' | 'warning'
  message: string
  stepPath: (number | string)[] // Path to the step in the steps tree
}

const findObject = (objects: AbstractObject[] | undefined, id: string) => {
  return objects?.find((obj) => obj.id === id)
}
const findLocation = (
  locations: AbstractLocation[] | undefined,
  id: string,
) => {
  return locations?.find((loc) => loc.id === id)
}
const findAction = (actions: AbstractAction[] | undefined, id: string) => {
  return actions?.find((act) => act.id === id)
}

/**
 * Analyze an AbstractTask for static errors and warnings.
 * @param task The abstract task to analyze
 * @returns Array of issues found
 */
export const analyzeAbstractTask = (task: AbstractTask): AnalyzerIssue[] => {
  const issues: AnalyzerIssue[] = []
  const { objects, locations, actions, robot } = task

  // analyzeSteps takes the isHoldingObject state at the start of the sequence
  // and returns the final isHoldingObject state after processing the sequence.
  // It handles recursive calls for nested steps.
  const analyzeSteps = (
    steps: AbstractStep[],
    path: (number | string)[] = [],
    isHoldingInitially: boolean = false,
  ): boolean => {
    let isHoldingObject = isHoldingInitially

    for (let idx = 0; idx < steps.length; idx++) {
      const step = steps[idx]
      const currentPath = [...path, idx]

      // Check for pick when hand is full using the state before this step
      if (step.type === 'pick' && isHoldingObject) {
        issues.push({
          type: 'error',
          message:
            'Robot attempting to pick while already holding an object (missing intermediate place)',
          stepPath: currentPath,
        })
      }

      // Check for place when hand is empty using the state before this step
      if (step.type === 'place' && !isHoldingObject) {
        issues.push({
          type: 'error',
          message:
            'Robot attempting to place but not holding an object (missing intermediate pick)',
          stepPath: currentPath,
        })
      }

      // Check for missing condition in when block
      if (step.type === 'when' && !step.condition) {
        issues.push({
          type: 'error',
          message: 'When block is missing a condition',
          stepPath: currentPath,
        })
      }

      // Update isHoldingObject state based on current step for the *next* step in this sequence.
      // This update happens regardless of whether the step is nested or not, as the state flows sequentially.
      if (step.type === 'pick') {
        isHoldingObject = true
      } else if (step.type === 'place') {
        isHoldingObject = false
      }

      // Check for object existence and properties in pick (using state before update)
      if (step.type === 'pick') {
        const obj = findObject(objects, step.object)
        if (!obj) {
          issues.push({
            type: 'error',
            message: `Object with id '${step.object}' not found`,
            stepPath: currentPath,
          })
        } else {
          // Check weight
          if (
            robot?.max_load !== undefined &&
            obj.weight !== undefined &&
            obj.weight > robot.max_load
          ) {
            issues.push({
              type: 'error',
              message: `Object '${obj.name}' (weight ${obj.weight}) exceeds robot max load (${robot.max_load})`,
              stepPath: currentPath,
            })
          }
          // Check dimensions
          if (
            robot &&
            typeof robot.max_open_arm === 'number' &&
            obj.dimensions
          ) {
            const maxOpenArm = robot.max_open_arm
            if (obj.dimensions.some((dim) => dim > maxOpenArm)) {
              issues.push({
                type: 'error',
                message: `Object '${obj.name}' (dimensions ${obj.dimensions.join('x')}) exceeds robot max open arm (${maxOpenArm})`,
                stepPath: currentPath,
              })
            }
          }
        }
      }
      // Check for location existence and properties in place (using state before update)
      if (step.type === 'place') {
        const loc = findLocation(locations, step.location)
        if (!loc) {
          issues.push({
            type: 'error',
            message: `Location with id '${step.location}' not found`,
            stepPath: currentPath,
          })
        } else {
          if (
            robot?.max_range !== undefined &&
            loc.distance !== undefined &&
            loc.distance > robot.max_range
          ) {
            issues.push({
              type: 'warning',
              message: `Location '${loc.name}' (distance ${loc.distance}) exceeds robot max range (${robot.max_range})`,
              stepPath: currentPath,
            })
          }
        }
      }
      // Check for action existence in processing (using state before update)
      if (step.type === 'processing') {
        const act = findAction(actions, step.action)
        if (!act) {
          issues.push({
            type: 'error',
            message: `Action with id '${step.action}' not found`,
            stepPath: currentPath,
          })
        }
      }

      // Recursively analyze nested steps, passing the current holding state.
      // The state after a repeat or when block is non-deterministic,
      // so we do NOT update the holding state of the outer sequence based on their result.
      if (step.type === 'repeat') {
        // The `isHoldingObject` passed to the recursive call is the state *after* the current step.
        isHoldingObject = analyzeSteps(
          step.steps,
          [...currentPath, 'steps'],
          isHoldingObject,
        )
      } else if (step.type === 'when') {
        // Analyze both branches, passing the current holding state.
        const finalHoldingStateDo = analyzeSteps(
          step.do,
          [...currentPath, 'do'],
          isHoldingObject,
        )
        let finalHoldingStateOtherwise = isHoldingObject
        if (step.otherwise) {
          finalHoldingStateOtherwise = analyzeSteps(
            step.otherwise,
            [...currentPath, 'otherwise'],
            isHoldingObject,
          )
        }
        // If either branch results in holding an object, then the overall state after 'when' is holding.
        isHoldingObject = finalHoldingStateDo || finalHoldingStateOtherwise
      }
      // Note: isHoldingObject is updated above based on the current step's type,
      // and this updated state will be used for the next iteration of the loop
      // or passed to recursive calls for nested blocks.
    }
    return isHoldingObject // Return the final state of this sequence
  }

  // Start the analysis with isHoldingObject = false initially.
  analyzeSteps(task.steps, [], false)
  return issues
}
