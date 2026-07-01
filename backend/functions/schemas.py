from typing import TypedDict, List, Optional, Union, Literal

# Reuse the AbstractStep and AbstractCondition definitions from chat.py but simplify for validation
# We'll define the expected structure from the LLM output.


class MessagePart(TypedDict):
    type: Literal["text", "warning"]
    content: str


class AbstractCondition(TypedDict):
    type: Literal["sensor_signal", "find_object", "human_feedback", "touch_detect", "gesture", "timer", "voice"]
    sensor: Optional[str]  # for sensor_signal
    objectId: Optional[int]  # for find_object
    objectName: Optional[str]  # for find_object
    gestureType: Optional[Literal["THUMBS_UP", "OPEN_HAND"]]  # for gesture
    seconds: Optional[int]  # for timer
    voiceWord: Optional[Literal["YES", "NO", "DONE", "PROCEED"]]  # for voice


class AbstractPickStep(TypedDict):
    type: Literal["pick"]
    objectId: int
    objectName: str


class AbstractPlaceStep(TypedDict):
    type: Literal["place"]
    locationId: int
    locationName: str


class AbstractProcessingStep(TypedDict):
    type: Literal["processing"]
    actionId: int
    actionName: str


class AbstractMoveToStep(TypedDict):
    type: Literal["move_to"]
    motionType: Literal["LINEAR", "JOINT"]
    locationId: int
    locationName: str


class AbstractGripperStep(TypedDict):
    type: Literal["gripper"]
    state: Literal["OPEN", "CLOSE"]


class AbstractHumanActionStep(TypedDict):
    type: Literal["human_action"]
    description: str
    confirmEvent: Optional[AbstractCondition]


class AbstractNotifyActionStep(TypedDict):
    type: Literal["notify_action"]
    description: str


class AbstractRepeatStep(TypedDict):
    type: Literal["repeat"]
    times: int
    steps: List["AbstractStep"]


class AbstractRepeatUntilStep(TypedDict):
    type: Literal["repeat_until"]
    condition: AbstractCondition
    steps: List["AbstractStep"]  # renamed from 'do' to avoid confusion with Python keyword


class AbstractWaitStep(TypedDict):
    type: Literal["wait"]
    seconds: int


class AbstractWhenStep(TypedDict):
    type: Literal["when"]
    condition: Optional[AbstractCondition]
    steps: List["AbstractStep"]  # 'do'
    otherwiseSteps: Optional[List["AbstractStep"]]  # 'otherwise'


# Union of all step types
AbstractStep = Union[
    AbstractPickStep,
    AbstractPlaceStep,
    AbstractProcessingStep,
    AbstractMoveToStep,
    AbstractGripperStep,
    AbstractWaitStep,
    AbstractHumanActionStep,
    AbstractNotifyActionStep,
    AbstractRepeatStep,
    AbstractRepeatUntilStep,
    AbstractWhenStep,
]

# Expected LLM response structure


class LLMResponse(TypedDict):
    answer: str
    task: List[AbstractStep]
    # We might also want to include warnings, but we can compute them separately

# Final API response structure


class ChatApiResponse(TypedDict):
    messageParts: List[MessagePart]
    proposedTask: Optional[List[AbstractStep]]
    requiresConfirmation: bool
    validationWarnings: List[str]
