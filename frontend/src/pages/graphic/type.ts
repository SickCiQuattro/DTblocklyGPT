export interface TaskGraphicStructure {
  program: {
    control?: {
      control_type: string | null
      times?: number | null
      event?: {
        event_type: string | null
        find_object?: string | null
        find_object_id?: number | null
      }
      otherwise?: {
        pick: {
          object: string | null
          object_id?: number | null
        }
        processing?: {
          action: string | null
          action_id?: number | null
        }
        place: {
          location: string | null
          location_id?: number | null
        }
      }
      control?: {
        control_type: string | null
        times?: number | null
        event?: {
          event_type: string | null
          find_object?: string | null
          find_object_id?: number | null
        }
        otherwise?: {
          pick: {
            object: string | null
            object_id?: number | null
          }
          processing?: {
            action: string | null
            action_id?: number | null
          }
          place: {
            location: string | null
            location_id?: number | null
          }
        }
        pick: {
          object: string | null
          object_id?: number | null
        }
        processing?: {
          action: string | null
          action_id?: number | null
        }
        place: {
          location: string | null
          location_id?: number | null
        }
      }
      pick: {
        object: string | null
        object_id?: number | null
      }
      processing?: {
        action: string | null
        action_id?: number | null
      }
      place: {
        location: string | null
        location_id?: number | null
      }
    }
    pick?: {
      object: string | null
      object_id?: number | null
    }
    processing?: {
      action: string | null
      action_id?: number | null
    }
    place?: {
      location: string | null
      location_id?: number | null
    }
  }
  editMode: boolean
}
