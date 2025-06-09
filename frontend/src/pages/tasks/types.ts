export interface TaskType {
  id: number
  description: string
  last_modified: string
  name: string
  owner: string
  owner__username: string
  shared: boolean
}

export type TaskDetailType = {
  id: number
  description: string
  name: string
  shared: boolean
  code: string
}

export type AbstractObject = {
  id: string;
  name: string;
  weight?: number;
  dimensions?: number[]; 
};

export type AbstractLocation = {
  id: string;
  name: string;
  distance?: number;
};

export type AbstractAction = {
  id: string;
  name: string;
};

export type AbstractRobot = {
  max_load?: number;
  max_range?: number;
  max_open_arm?: number;
};

export type AbstractTask = {
  taskName: string;
  description?: string;
  steps: AbstractStep[];
  objects?: AbstractObject[];
  locations?: AbstractLocation[];
  actions?: AbstractAction[];
  robot?: AbstractRobot;
};

export type AbstractStep =
  | AbstractPickStep
  | AbstractPlaceStep
  | AbstractProcessingStep
  | AbstractRepeatStep
  | AbstractWhenStep;

export type AbstractPickStep = {
  type: 'pick';
  object: string; 
};

export type AbstractPlaceStep = {
  type: 'place';
  location: string;
};

export type AbstractProcessingStep = {
  type: 'processing';
  action: string; 
};

export type AbstractRepeatStep = {
  type: 'repeat';
  times: number;
  steps: AbstractStep[];
};

export type AbstractWhenStep = {
  type: 'when';
  condition: AbstractCondition;
  do: AbstractStep[];
  otherwise?: AbstractStep[];
};

export type AbstractCondition =
  | { type: 'sensor_signal'; sensor: string }
  | { type: 'find_object'; object: string }
  | { type: 'human_feedback' };

