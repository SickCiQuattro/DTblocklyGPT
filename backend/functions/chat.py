import logging
import json
import copy
from typing import List, Dict, Any, Tuple
from django.http import HttpResponse, HttpRequest
from backend.utils.response import (
    HttpMethod,
    invalid_request_method,
    error_response,
    success_response,
    unauthorized_request,
)
from json import loads
from openai import OpenAI
from dataclasses import dataclass

from backend.models import Object, Action, Location
from django.db.models import Q
from django.contrib.auth.models import User
import os

LLM_PROVIDER = os.getenv("LLM_PROVIDER", "gemini").lower()
LLM_MODEL = os.getenv("LLM_MODEL", "gemini-2.5-flash")
LLM_API_KEY = os.getenv("LLM_API_KEY") or os.getenv("GEMINI_API_KEY") or os.getenv("OPENAI_API_KEY")
LLM_BASE_URL = os.getenv("LLM_BASE_URL")
LLM_TIMEOUT = int(os.getenv("LLM_TIMEOUT", "30"))
LLM_MAX_RETRIES = int(os.getenv("LLM_MAX_RETRIES", "3"))
CHATGPT_TEMPERATURE = 0.0

logger = logging.getLogger(__name__)


@dataclass
class ProviderLLMResponse:
    answer: str                    # Testo naturale estratto
    raw_arguments: dict            # Argomenti della tool call parsati
    raw_response: object           # Risposta originale del client per debug


class LLMProvider:
    """Single OpenAI-compatible provider. base_url selects Gemini vs OpenAI (see get_llm_provider)."""

    def __init__(self, api_key: str, base_url: str = None, model: str = "gemini-2.5-flash", timeout: int = 30, max_retries: int = 3):
        self.api_key = api_key
        self.base_url = base_url
        self.model = model
        self.timeout = timeout
        self.max_retries = max_retries
        self.client = OpenAI(
            api_key=self.api_key,
            base_url=self.base_url,
            timeout=self.timeout,
            max_retries=self.max_retries
        )

    def complete(self, messages: List[Dict[str, Any]], tools: List[Dict[str, Any]], tool_name: str, temperature: float = 0.0) -> ProviderLLMResponse:
        response = self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=temperature,
            tools=tools,
            tool_choice={
                "type": "function",
                "function": {
                    "name": tool_name,
                },
            },
            parallel_tool_calls=False,
        )
        msg = response.choices[0].message
        if msg.tool_calls and len(msg.tool_calls) > 0:
            arguments_str = msg.tool_calls[0].function.arguments
        else:
            arguments_str = msg.content or "{}"

        try:
            raw_arguments = json.loads(arguments_str)
        except Exception:
            raw_arguments = {}

        answer = raw_arguments.get("answer", "")
        return ProviderLLMResponse(
            answer=answer,
            raw_arguments=raw_arguments,
            raw_response=response
        )


def get_llm_provider() -> LLMProvider:
    if not LLM_API_KEY:
        raise ValueError("API LLM Key not found in environment variables.")

    if LLM_PROVIDER == "gemini":
        base_url = LLM_BASE_URL or "https://generativelanguage.googleapis.com/v1beta/openai/"
    elif LLM_PROVIDER == "openai":
        base_url = LLM_BASE_URL  # None → official OpenAI endpoint
    else:
        raise ValueError(f"Provider LLM '{LLM_PROVIDER}' not supported.")

    return LLMProvider(
        api_key=LLM_API_KEY,
        base_url=base_url,
        model=LLM_MODEL,
        timeout=LLM_TIMEOUT,
        max_retries=LLM_MAX_RETRIES,
    )


CHATGPT_ALWAYS_REPLY = "Always reply to the user. You can't left the property 'answer' blank. If you're unsure of an answer, you can ask the user to repeat the request."


CHATGPT_ERROR = "A problem occurred while creating the new message. Please try again."


def search_existing_libraries(
    user: User, type: Object | Location | Action, name: str
) -> Tuple[int, str, str]:
    # Object
    if type == Object:
        object = (
            Object.objects.filter(Q(owner=user) | Q(shared=True))
            .filter(name__iexact=name)
            .first()
        )

        if object is not None:
            keywords = None
            if object.keywords:
                keywords = ",".join(object.keywords)
            return object.id, object.name, keywords
        else:
            # Search for keywords
            objectsOfUser = Object.objects.filter(Q(owner=user) | Q(shared=True))

            object_match_keyword = None
            for object in objectsOfUser:
                if object.keywords:
                    lowercase_keywords = [
                        keyword.lower() for keyword in object.keywords
                    ]
                    if name.lower() in lowercase_keywords:
                        object_match_keyword = object
                        break

            if object_match_keyword is not None:
                return (
                    object_match_keyword.id,
                    object_match_keyword.name,
                    ",".join(object_match_keyword.keywords),
                )
            else:
                return None, name, None

    # Location
    elif type == Location:
        location = (
            Location.objects.filter(Q(owner=user) | Q(shared=True))
            .filter(name__iexact=name)
            .first()
        )

        if location is not None:
            keywords = None
            if location.keywords:
                keywords = ",".join(location.keywords)
            return location.id, location.name, keywords
        else:
            # Search for keywords
            locationsOfUser = Location.objects.filter(Q(owner=user) | Q(shared=True))

            location_match_keyword = None
            for location in locationsOfUser:
                if location.keywords:
                    lowercase_keywords = [
                        keyword.lower() for keyword in location.keywords
                    ]
                    if name.lower() in lowercase_keywords:
                        location_match_keyword = location
                        break

            if location_match_keyword is not None:
                return (
                    location_match_keyword.id,
                    location_match_keyword.name,
                    ",".join(location_match_keyword.keywords),
                )
            else:
                return None, name, None

    # Action
    elif type == Action:
        action = (
            Action.objects.filter(Q(owner=user) | Q(shared=True))
            .filter(name__iexact=name)
            .first()
        )

        if action is not None:
            keywords = None
            if action.keywords:
                keywords = ",".join(action.keywords)
            return action.id, action.name, keywords
        else:
            # Search for keywords
            actionsOfUser = Action.objects.filter(Q(owner=user) | Q(shared=True))

            action_match_keyword = None
            for action in actionsOfUser:
                if action.keywords:
                    lowercase_keywords = [
                        keyword.lower() for keyword in action.keywords
                    ]
                    if name.lower() in lowercase_keywords:
                        action_match_keyword = action
                        break

            if action_match_keyword is not None:
                return (
                    action_match_keyword.id,
                    action_match_keyword.name,
                    ",".join(action_match_keyword.keywords),
                )
            else:
                return None, name, None


CHATGPT_INSTRUCTIONS_MULTIMODAL = """
# OBJECTIVE #
You are an assistant designed to extract user intents from natural language and convert them into or edit a collaborative robot task structured as a JSON program.
The task program consists of sequential and conditional steps. You may need to create a new task or modify an existing one.
Steps can be nested inside "steps", "do", or "otherwise" arrays to represent loops and conditions.

You must reply with a JSON response that follows this format:
{{
  "answer": string,       // Natural language explanation or clarification to the user
  "task": AbstractStep[], // The updated or created task program
  "taskModified": boolean // Set to true if you are proposing a new task, making changes, or editing the existing task in response to a user request to modify the workspace. Set to false if the user is only asking a question, asking to analyze the workspace, asking for explanations, or if no changes are being proposed to the workspace.
}}

Where AbstractStep is one of:

  - Pick Step:
    {{
      "type": "pick",
      "objectId": number,
      "objectName": string
    }}

  - Place Step:
    {{
      "type": "place",
      "locationId": number,
      "locationName": string
    }}

  - Processing Step:
    {{
      "type": "processing",
      "actionId": number,
      "actionName": string
    }}

  - Move-To Step (moves the robot to a location without picking/placing):
    {{
      "type": "move_to",
      "motionType": "LINEAR" | "JOINT",
      "locationId": number,
      "locationName": string
    }}

  - Gripper Step (open or close the robot gripper):
    {{
      "type": "gripper",
      "state": "OPEN" | "CLOSE"
    }}

  - Wait Step (pause the robot for a set amount of seconds):
    {{
      "type": "wait",
      "seconds": number
    }}

  - Human Action Step (pause the robot and show a message to the operator):
    {{
      "type": "human_action",
      "description": string,
      "confirmEvent": AbstractCondition | null
    }}

    - Notify Action Step (send a message to the operator without stopping the robot):
    {{
      "type": "notify_action",
      "description": string
    }}

  - Repeat-Until Step:
    {{
      "type": "repeat_until",
      "condition": AbstractCondition,
      "do": AbstractStep[]
    }}

  - Repeat Step:
    {{
      "type": "repeat",
      "times": number,
      "steps": AbstractStep[]
    }}

  - When-Do Step:
    {{
      "type": "when",
      "condition": AbstractCondition | null,
      "do": AbstractStep[]
    }}

  - When-Do-Otherwise Step:
    {{
      "type": "when",
      "condition": AbstractCondition | null,
      "do": AbstractStep[],
      "otherwise": AbstractStep[] | null
    }}

Conditions (AbstractCondition) can be one of:
- {{"type": "sensor_signal", "sensor": "camera" | "ir"}}
- {{"type": "find_object", "objectId": number, "objectName": string}}
- {{"type": "human_feedback"}}
- {{"type": "touch_detect"}}
- {{"type": "gesture", "gestureType": "THUMBS_UP" | "THUMBS_DOWN" | "OPEN_HAND" | "FIST" | "PEACE" | "OK" | "THREE_FINGERS" | "PINCH" | "POINTING"}}
- {{"type": "timer", "seconds": number}}

# BLOCKLY TOOLBOX & CATEGORIES #
In the visual Blockly interface, blocks are organized into the following collapsible categories in the toolbox sidebar:

1. "Task Flow" (Orange/Coral):
   - "Repeat times" (repeat_block): Repeats a nested sequence of steps a set number of times.
   - "Repeat forever" (loop_block): Infinite loop (not supported by backend, only used in frontend).
   - "Repeat until" (repeat_until_block): Repeats nested steps until a condition is met.
   - "When → Do" (when_block): Runs steps only if a condition is met.
   - "When → Do / Otherwise" (when_otherwise_block): Runs one set of steps if a condition is met, otherwise runs another set of steps.

2. "Robot Actions" (Indigo/Blue):
   - "Pick up" (pick_block): Grabs an object. Accepts "Objects" block as input.
   - "Perform" (processing_block): Executes a skill or procedure. Accepts "Procedures" block as input.
   - "Place at" (place_block): Places a held object at a location. Accepts "Destinations" block as input.
   - "Move to" (move_to_block): Moves the robot to a destination. Accepts "Destinations" block as input.
   - "Open / Close Gripper" (gripper_block): Controls the robot gripper (OPEN/CLOSE).
   - "Wait" (wait_block): Pauses execution for a specified duration in seconds.

3. "Human Step" (Green/Teal):
   - "Pause and show message" (human_action_block): Pauses the robot and waits for operator input or condition.
   - "Show message" (notify_action_block): Shows a message to the operator without stopping the robot.

4. "My Workspace" (Grey/Neutral):
   - "Objects" (object_block): Pill blocks representing objects from the database (e.g. widget, red cube).
   - "Destinations" (location_block): Pill blocks representing locations from the database (e.g. bin A, pick station).
   - "Procedures" (action_block): Pill blocks representing actions from the database (e.g. inspect, assemble).

5. "Conditions" (Yellow/Amber):
   - "Object detected" (find_object_block): Detects if a specific object is present.
   - "Contact detected" (touch_detect_block): Detects physical contact.
   - "Gesture detected" (gesture_block): Detects human gestures (THUMBS_UP, THUMBS_DOWN, OPEN_HAND, FIST, PEACE, OK, THREE_FINGERS, PINCH, POINTING).
   - "Time passed" (timer_block): Triggered after a set amount of seconds.
   - "External signal received" (sensor_signal_block): Listens to a sensor signal (camera, ir).
   - "AND" (logic_and_block): Combines two conditions (both must be true).
   - "OR" (logic_or_block): Combines two conditions (at least one must be true).
   - "NOT" (logic_not_block): Inverts a condition.

6. "My Tasks" (Purple):
   - "My Task" (macro_task_block): Reuse another saved task as a single macro block.

If the user asks where to find a block or how they are organized, guide them to these categories!

# CONNECTION RULES #
All step blocks (pick, place, processing, move_to, gripper, human_action, repeat, when, when_otherwise)
can be freely chained in sequence. Condition blocks can only appear inside a "when" step or as
the "confirmEvent" of a "human_action" step.

# CONTEXT #
- The user is not an expert in robotics or programming.
- The user defines tasks via natural language.
- You must interpret their requests accurately using only the provided database.
- Always use the exact "objectId"/"objectName", "locationId"/"locationName", and "actionId"/"actionName" from the database.
- If the request is ambiguous, incomplete, or references unknown items, respond **only** with a clear natural language question in "answer" asking for clarification and do not modify the task returning the task structure as it is.
- The default language is English. You MUST reply in the language used by the user in their most recent message. If the user writes in English, reply in English. If the user writes in Italian, reply in Italian. Do not default or switch to Italian if the user's latest query is in English, even if previous parts of the chat log contain Italian.

# IMPORTANT INSTRUCTIONS #
- When responding to the user in natural language (the "answer" field), you MUST refer to blocks EXACTLY by their user-facing names in quotes as defined in the "# BLOCKLY TOOLBOX & CATEGORIES #" list (e.g. "Pick up" instead of "Pick" or "pick_block", "Pause and show message" instead of "human_action" or "Wait for Operator", "Show message" instead of "notify_action", "Repeat times" instead of "repeat_block", "Perform" instead of "processing_block", "Place at" instead of "place_block", etc.). Never use their technical type names (e.g. pick, place, processing, repeat, when, human_action, etc.) or generic code-like names in your conversational answers.
- The "# CURRENT TASK SNAPSHOT #" is the ONLY ground truth for the actual state of the workspace. Do NOT assume that blocks discussed in previous turns of the conversation are in the workspace unless they are explicitly present in the "# CURRENT TASK SNAPSHOT #" of the current turn.
- If the "# CURRENT TASK SNAPSHOT #" is empty (e.g. `[]`), then the workspace is currently empty, regardless of what was discussed in previous turns.
- If the user asks about the current state, content, or blocks in the workspace, you MUST describe the blocks listed in "# CURRENT TASK SNAPSHOT #" exactly as they are, without modifying them, adding phantom blocks, or inventing steps. You must return the "task" field EXACTLY matching the provided "# CURRENT TASK SNAPSHOT #" array.
- CRITICAL: You must NEVER flatten nested steps inside loops or conditionals in the "task" array. All steps inside "repeat" MUST be nested inside the "steps" array of that repeat step. All steps inside "when" or "repeat_until" MUST be nested inside the "do" or "otherwise" array of that block. Returning them as flat sibling steps in the root "task" array is strictly forbidden and will break the system. Keep the exact nested structure of any block program.
- If the user's message is purely informational, analytical, or asking about the state/content of the workspace (e.g. "Cosa c'è nel mio workspace?", "Analizza il workspace"), you must NOT modify the task. You must return the "task" field EXACTLY matching the provided "# CURRENT TASK SNAPSHOT #" array structure, retaining its full nested representation without any changes.
- You MUST set the "taskModified" field to true ONLY when you are proposing a new task, making changes, or editing the existing task in response to a user request to modify the workspace. You MUST set "taskModified" to false when the user is only asking a question, asking to analyze the workspace, asking for explanations, or if no changes are being proposed to the workspace.
- Between a user request and the next one, the user may change the existing task structure using the Blockly interface. Always consider the latest task structure provided.
- If no modifications are needed, return the existing task structure as it is.
- Task sequence must be only one. So don't return an array of tasks (i.e., don't return "task": [[AbstractStep], [AbstractStep], ...]).
- By default, if the user asks for a request, modify the existing task. Only if the user explicitly asks for a new task, create a new one from scratch.

# HOW TO EDIT/MODIFY THE CURRENT TASK SNAPSHOT #
When the user asks to add, remove, or modify steps relative to the existing workspace task snapshot:
1. Locate the target step or container block in the "# CURRENT TASK SNAPSHOT #" array (e.g. a "repeat", "repeat_until", "when", or "human_action" step).
2. If the user asks to insert steps "inside" or "in" a loop or conditional block:
   - For a "Repeat times" block (type "repeat"): insert the nested steps inside its "steps" array.
   - For a "Repeat until" block (type "repeat_until"): insert the nested steps inside its "do" array.
   - For a "When → Do" block (type "when"): insert the nested steps inside its "do" array.
3. If the user asks to set a confirmation event or sensor trigger for a "Pause and show message" block (type "human_action"):
   - Set or update its "confirmEvent" property with the correct condition object (e.g., {"type": "gesture", "gestureType": "OPEN_HAND"}).
4. Ensure all other unmodified steps in the task tree are preserved exactly as they are in their correct nested positions, without flattening them or creating unrelated blocks (like adding "when" blocks externally).

# DATABASE #
You have access to the following lists (always use exact IDs and names):
- Objects: {{objects}}
- Locations: {{locations}}
- Actions: {{actions}}

# EXAMPLES #
User says: "Pick the widget and place it in the bin A."
Response:
{{
  "answer": "I created a task to pick the object 'widget' and place it at 'bin A'.",
  "task": [
      {{"type": "pick", "objectId": 3, "objectName": "widget"}},
      {{"type": "place", "locationId": 2, "locationName": "bin A"}}
    ]
}}

User says: "Move to the inspection zone then open the gripper."
Response:
{{
  "answer": "I added a move-to step towards the inspection zone followed by an open-gripper step.",
  "task": [
      {{"type": "move_to", "motionType": "LINEAR", "locationId": 5, "locationName": "inspection zone"}},
      {{"type": "gripper", "state": "OPEN"}}
    ]
}}

User says: "Wait for the operator to put a part on the table before starting."
Response:
{{
  "answer": "I added a human action step that pauses the robot and waits for the operator.",
  "task": [
      {{"type": "human_action", "description": "Please place the part on the table and confirm.", "confirmEvent": {{"type": "human_feedback"}}}}
    ]
}}

User says: "Repeat 2 times: pick red_pill and then wait 3 seconds."
Response:
{{
  "answer": "I added a repeat loop to repeat 2 times, containing a pick step for 'red_pill' and a wait step of 3 seconds.",
  "task": [
    {{
      "type": "repeat",
      "times": 2,
      "steps": [
        {{"type": "pick", "objectId": 1, "objectName": "red_pill"}},
        {{"type": "wait", "seconds": 3}}
      ]
    }}
  ],
  "taskModified": true
}}

User says: "Repeat until a contact is detected: pick flask and place in box."
Response:
{{
  "answer": "I structured a repeat until loop that runs until contact is detected, containing a pick step for 'flask' and a place step for 'box'.",
  "task": [
    {{
      "type": "repeat_until",
      "condition": {{"type": "touch_detect"}},
      "do": [
        {{"type": "pick", "objectId": 4, "objectName": "flask"}},
        {{"type": "place", "locationId": 3, "locationName": "box"}}
      ]
    }}
  ],
  "taskModified": true
}}

User says: "If camera detects widget, pick it up, otherwise wait 5 seconds."
Response:
{{
  "answer": "I added a conditional block: if the camera detects the widget, the robot will pick it up, otherwise it will wait for 5 seconds.",
  "task": [
    {{
      "type": "when",
      "condition": {{"type": "sensor_signal", "sensor": "camera"}},
      "do": [
        {{"type": "pick", "objectId": 3, "objectName": "widget"}}
      ],
      "otherwise": [
        {{"type": "wait", "seconds": 5}}
      ]
    }}
  ],
  "taskModified": true
}}
"""


CHATGPT_FUNCTION_MULTIMODAL = {
    "type": "function",
    "function": {
        "name": "extract_robot_program",
        "description": "Extracts and structures a collaborative robot program from natural language",
        "parameters": {
            "type": "object",
            "properties": {
                "answer": {
                    "type": "string",
                    "description": "Natural language explanation shown to the user",
                },
                "task": {
                    "type": "string",
                    "description": "Sequence of robot steps (following the AbstractStep format from instructions). MUST BE A VALID JSON STRING OF AN ARRAY (e.g. \"[{\\\"type\\\": \\\"pick\\\", \\\"objectId\\\": 4, \\\"objectName\\\": \\\"flask\\\"}]\"). Return an empty array string \"[]\" if empty.",
                },
                "taskModified": {
                    "type": "boolean",
                    "description": "Set to true ONLY if you are proposing a new task, making changes, or editing the existing task in response to a user request to modify the workspace. Set to false if the user is only asking a question, asking to analyze the workspace, asking for explanations, or if no changes are being proposed to the workspace.",
                },
            },
            "additionalProperties": False,
            "required": ["answer", "task", "taskModified"],
        },
    },
}


def repair_flattened_steps(steps, warnings=None):
    if not isinstance(steps, list):
        return steps

    repaired = []
    i = 0
    while i < len(steps):
        step = steps[i]
        if not isinstance(step, dict):
            repaired.append(step)
            i += 1
            continue

        step_type = step.get("type")

        # Unify children keys based on block types to prevent fallback gaps
        if step_type == "repeat":
            has_do = "do" in step and isinstance(step["do"], list) and len(step["do"]) > 0
            has_steps = "steps" in step and isinstance(step["steps"], list) and len(step["steps"]) > 0
            if has_do and not has_steps:
                step["steps"] = step.pop("do")
                if "do" in step:
                    del step["do"]
        elif step_type == "repeat_until":
            has_do = "do" in step and isinstance(step["do"], list) and len(step["do"]) > 0
            has_steps = "steps" in step and isinstance(step["steps"], list) and len(step["steps"]) > 0
            if has_steps and not has_do:
                step["do"] = step.pop("steps")
                if "steps" in step:
                    del step["steps"]

        # Recursive repair of children first if they exist
        if step_type == "repeat":
            if "steps" in step and isinstance(step["steps"], list):
                step["steps"] = repair_flattened_steps(step["steps"], warnings)
        elif step_type in ["repeat_until", "when"]:
            if "do" in step and isinstance(step["do"], list):
                step["do"] = repair_flattened_steps(step["do"], warnings)
            if step_type == "when" and "otherwise" in step and isinstance(step["otherwise"], list):
                step["otherwise"] = repair_flattened_steps(step["otherwise"], warnings)

        # Check if this is an empty container at the current level, followed by some sibling steps that should be nested
        is_empty_container = False
        children_key = None

        if step_type == "repeat":
            children_key = "steps"
            is_empty_container = (children_key not in step) or (not isinstance(step[children_key], list)) or (len(step[children_key]) == 0)
        elif step_type in ["repeat_until", "when"]:
            children_key = "do"
            is_empty_container = (children_key not in step) or (not isinstance(step[children_key], list)) or (len(step[children_key]) == 0)

        if is_empty_container and children_key is not None:
            subsequent_siblings = steps[i + 1:]
            if subsequent_siblings:
                if warnings is not None:
                    warnings.append({
                        "severity": "warning",
                        "message": f"Auto-corrected: flattened steps were nested inside the empty '{step_type}' container."
                    })
                nested_siblings = repair_flattened_steps(subsequent_siblings, warnings)
                step[children_key] = nested_siblings
                repaired.append(step)
                i = len(steps)
                continue

        repaired.append(step)
        i += 1

    return repaired


def new_message_multimodal(request: HttpRequest) -> HttpResponse:
    try:
        if request.user.is_authenticated:
            if request.method == HttpMethod.POST.value:
                data = loads(request.body)
                message = data.get("message")
                chat_log = data.get("chatLog")
                task_structure = data.get("taskStructure")
                data_locations = data.get("dataLocations")
                data_objects = data.get("dataObjects")
                data_actions = data.get("dataActions")

                if message is None:
                    return error_response("Message is required")

                data_result = {}

                replacements = {
                    "{{objects}}": json.dumps(data_objects, ensure_ascii=False),
                    "{{locations}}": json.dumps(data_locations, ensure_ascii=False),
                    "{{actions}}": json.dumps(data_actions, ensure_ascii=False),
                }
                prompt_template = CHATGPT_INSTRUCTIONS_MULTIMODAL
                for placeholder, value in replacements.items():
                    prompt_template = prompt_template.replace(placeholder, value)

                prompt_template += f"\n\n# CURRENT TASK SNAPSHOT #\n{json.dumps(task_structure, ensure_ascii=False)}"

                system_message = {"role": "system", "content": prompt_template}

                if chat_log is None or len(chat_log) == 0:
                    chat_log = [system_message]
                else:
                    if chat_log[0]["role"] == "system":
                        chat_log[0] = system_message
                    else:
                        chat_log.insert(0, system_message)

                chat_log.append({"role": "user", "content": message})

                provider = get_llm_provider()

                response_json = {}
                answer = ""
                llm_task = []

                for attempt in range(3):
                    llm_response = provider.complete(
                        messages=chat_log,
                        tools=[CHATGPT_FUNCTION_MULTIMODAL],
                        tool_name=CHATGPT_FUNCTION_MULTIMODAL["function"]["name"],
                        temperature=CHATGPT_TEMPERATURE
                    )
                    response_json = llm_response.raw_arguments
                    answer = response_json.get("answer", "").strip()
                    llm_task_raw = response_json.get("task", "[]")
                    if isinstance(llm_task_raw, str):
                        try:
                            llm_task = json.loads(llm_task_raw)
                        except Exception:
                            llm_task = []
                    else:
                        llm_task = llm_task_raw or []

                    if answer:
                        break

                    chat_log.append({"role": "system", "content": CHATGPT_ALWAYS_REPLY})

                chat_log = [msg for msg in chat_log if not (msg["role"] == "system" and msg["content"] == CHATGPT_ALWAYS_REPLY)]

                if not answer:
                    answer = "Okay, let's continue."
                    response_json["answer"] = answer

                try:
                    validation_warnings = []
                    if isinstance(llm_task, list) and len(llm_task) > 0:
                        llm_task = repair_flattened_steps(llm_task, validation_warnings)
                    validated_task = []

                    def validate_step(step, step_index, warnings):
                        step_copy = copy.deepcopy(step)
                        step_type = step.get("type")

                        if step_type == "pick":
                            object_id = step.get("objectId")
                            object_name = step.get("objectName")
                            obj = None
                            for obj_item in data_objects:
                                if (object_id is not None and str(obj_item["id"]) == str(object_id)) or \
                                   (object_id is not None and obj_item.get("name") and obj_item["name"].lower() == str(object_id).lower()) or \
                                   (object_name and obj_item.get("name") and obj_item["name"].lower() == object_name.lower()):
                                    obj = obj_item
                                    break
                            if obj is None:
                                warnings.append({
                                    "severity": "error",
                                    "message": f"Pick step {step_index}: object '{object_name or object_id}' not found."
                                })
                            else:
                                step_copy["objectId"] = obj["id"]
                                step_copy["objectName"] = obj["name"]

                        elif step_type == "place":
                            location_id = step.get("locationId")
                            location_name = step.get("locationName")
                            loc = None
                            for loc_item in data_locations:
                                if (location_id is not None and str(loc_item["id"]) == str(location_id)) or \
                                   (location_id is not None and loc_item.get("name") and loc_item["name"].lower() == str(location_id).lower()) or \
                                   (location_name and loc_item.get("name") and loc_item["name"].lower() == location_name.lower()):
                                    loc = loc_item
                                    break
                            if loc is None:
                                warnings.append({
                                    "severity": "error",
                                    "message": f"Place step {step_index}: location '{location_name or location_id}' not found."
                                })
                            else:
                                step_copy["locationId"] = loc["id"]
                                step_copy["locationName"] = loc["name"]

                        elif step_type == "processing":
                            action_id = step.get("actionId")
                            action_name = step.get("actionName")
                            act = None
                            for act_item in data_actions:
                                if (action_id is not None and str(act_item["id"]) == str(action_id)) or \
                                   (action_id is not None and act_item.get("name") and act_item["name"].lower() == str(action_id).lower()) or \
                                   (action_name and act_item.get("name") and act_item["name"].lower() == action_name.lower()):
                                    act = act_item
                                    break
                            if act is None:
                                warnings.append({
                                    "severity": "error",
                                    "message": f"Processing step {step_index}: action '{action_name or action_id}' not found."
                                })
                            else:
                                step_copy["actionId"] = act["id"]
                                step_copy["actionName"] = act["name"]

                        elif step_type == "move_to":
                            location_id = step.get("locationId")
                            location_name = step.get("locationName")
                            motion_type = step.get("motionType")
                            loc = None
                            for loc_item in data_locations:
                                if (location_id is not None and str(loc_item["id"]) == str(location_id)) or \
                                   (location_id is not None and loc_item.get("name") and loc_item["name"].lower() == str(location_id).lower()) or \
                                   (location_name and loc_item.get("name") and loc_item["name"].lower() == location_name.lower()):
                                    loc = loc_item
                                    break
                            if loc is None:
                                warnings.append({
                                    "severity": "error",
                                    "message": f"MoveTo step {step_index}: location '{location_name or location_id}' not found."
                                })
                            else:
                                step_copy["locationId"] = loc["id"]
                                step_copy["locationName"] = loc["name"]
                            if motion_type not in ["LINEAR", "JOINT"]:
                                warnings.append({
                                    "severity": "error",
                                    "message": f"MoveTo step {step_index}: invalid motionType '{motion_type}'."
                                })

                        elif step_type == "gripper":
                            state = step.get("state")
                            if state not in ["OPEN", "CLOSE"]:
                                warnings.append({
                                    "severity": "error",
                                    "message": f"Gripper step {step_index}: invalid state '{state}'."
                                })

                        elif step_type == "wait":
                            seconds = step.get("seconds")
                            if not isinstance(seconds, (int, float)) or seconds < 0:
                                warnings.append({
                                    "severity": "error",
                                    "message": f"Wait step {step_index}: invalid seconds '{seconds}'."
                                })

                        elif step_type == "human_action":
                            confirm_event = step.get("confirmEvent")
                            if confirm_event is not None:
                                validate_condition(confirm_event, f"{step_index}.human_action.confirmEvent", warnings)

                        elif step_type == "notify_action":
                            if not isinstance(step.get("description"), str):
                                warnings.append({
                                    "severity": "error",
                                    "message": f"NotifyAction step {step_index}: description must be a string."
                                })

                        elif step_type == "repeat":
                            times = step.get("times")
                            steps = step.get("steps")
                            if not steps:  # fallback if steps is None or empty list []
                                steps = step.get("do", [])
                            if not isinstance(times, int) or times <= 0:
                                warnings.append({
                                    "severity": "error",
                                    "message": f"Repeat step {step_index}: invalid times '{times}'."
                                })
                            validated_children = []
                            for i, sub_step in enumerate(steps):
                                validated_children.append(validate_step(sub_step, f"{step_index}.repeat[{i}]", warnings))
                            step_copy["steps"] = validated_children

                        elif step_type == "repeat_until":
                            condition = step.get("condition")
                            steps = step.get("do")
                            if not steps:  # fallback if do is None or empty list []
                                steps = step.get("steps", [])
                            if condition is not None:
                                validate_condition(condition, f"{step_index}.repeat_until.condition", warnings)
                            validated_children = []
                            for i, sub_step in enumerate(steps):
                                validated_children.append(validate_step(sub_step, f"{step_index}.repeat_until[{i}]", warnings))
                            step_copy["do"] = validated_children

                        elif step_type == "when":
                            condition = step.get("condition")
                            do_steps = step.get("do", [])
                            otherwise_steps = step.get("otherwise", [])
                            if condition is not None:
                                validate_condition(condition, f"{step_index}.when.condition", warnings)
                            validated_do = []
                            for i, sub_step in enumerate(do_steps):
                                validated_do.append(validate_step(sub_step, f"{step_index}.when.do[{i}]", warnings))
                            step_copy["do"] = validated_do
                            if otherwise_steps is not None:
                                validated_otherwise = []
                                for i, sub_step in enumerate(otherwise_steps):
                                    validated_otherwise.append(validate_step(sub_step, f"{step_index}.when.otherwise[{i}]", warnings))
                                step_copy["otherwise"] = validated_otherwise

                        else:
                            warnings.append({
                                "severity": "error",
                                "message": f"Step {step_index}: unknown step type '{step_type}'."
                            })

                        return step_copy

                    def validate_condition(condition, cond_index, warnings):
                        if not isinstance(condition, dict):
                            warnings.append({"severity": "error", "message": f"Condition {cond_index}: must be object."})
                            return
                        cond_type = condition.get("type")
                        if cond_type == "sensor_signal":
                            if condition.get("sensor") not in ["camera", "ir"]:
                                warnings.append({"severity": "error", "message": f"Condition {cond_index}: invalid sensor."})
                        elif cond_type == "find_object":
                            object_id = condition.get("objectId")
                            object_name = condition.get("objectName")
                            obj = None
                            for o in data_objects:
                                if (object_id is not None and str(o["id"]) == str(object_id)) or \
                                   (object_id is not None and o.get("name") and o["name"].lower() == str(object_id).lower()) or \
                                   (object_name and o.get("name") and o["name"].lower() == object_name.lower()):
                                    obj = o
                                    break
                            if obj is None:
                                warnings.append({"severity": "error", "message": f"Condition {cond_index}: unknown object '{object_name or object_id}'."})
                            else:
                                condition["objectId"] = obj["id"]
                                condition["objectName"] = obj["name"]
                        elif cond_type == "gesture":
                            gesture_type = condition.get("gestureType")
                            if gesture_type not in ["THUMBS_UP", "THUMBS_DOWN", "OPEN_HAND", "FIST", "PEACE", "OK", "THREE_FINGERS", "PINCH", "POINTING"]:
                                warnings.append({"severity": "error", "message": f"Condition {cond_index}: invalid gestureType."})
                        elif cond_type == "timer":
                            if not isinstance(condition.get("seconds"), int) or condition.get("seconds") < 0:
                                warnings.append({"severity": "error", "message": f"Condition {cond_index}: invalid seconds."})

                    for step_index, step in enumerate(llm_task):
                        validated_task.append(validate_step(step, step_index, validation_warnings))

                    message_parts = []
                    if answer:
                        message_parts.append({"type": "text", "content": answer})

                    frontend_warnings = [w["message"] for w in validation_warnings]
                    for warning_msg in frontend_warnings:
                        message_parts.append({"type": "warning", "content": warning_msg})

                    chat_log.append({"role": "assistant", "content": json.dumps(response_json)})

                    is_valid = not any(w["severity"] == "error" for w in validation_warnings)
                    task_modified = response_json.get("taskModified", True)
                    requires_confirmation = task_modified and len(validated_task) > 0 and is_valid

                    data_result = {
                        "messageParts": message_parts,
                        "proposedTask": validated_task if requires_confirmation else None,
                        "requiresConfirmation": requires_confirmation,
                        "validationWarnings": frontend_warnings,
                        "isValid": is_valid,
                        "chatLog": chat_log,
                        "response": {
                            "answer": answer,
                            "task": validated_task if requires_confirmation else None,
                            "taskModified": task_modified,
                            "finished": False,
                            "validationWarnings": frontend_warnings,
                        },
                        "fineTunedModel": "",
                        "fineTuningJobId": "",
                    }

                except Exception as inner_e:
                    logger.exception("Inner chat parse error")
                    data_result = {
                        "messageParts": [{"type": "text", "content": CHATGPT_ERROR}],
                        "proposedTask": None,
                        "requiresConfirmation": False,
                        "validationWarnings": [str(inner_e)],
                        "isValid": False,
                        "chatLog": chat_log,
                        "response": {
                            "answer": CHATGPT_ERROR,
                            "task": None,
                            "finished": False,
                            "validationWarnings": [str(inner_e)],
                        },
                        "fineTunedModel": "",
                        "fineTuningJobId": "",
                    }

                return success_response(data_result)
            else:
                return invalid_request_method()
        else:
            return unauthorized_request()
    except Exception as e:
        logger.exception("Exception in new_message_multimodal")
        return error_response(f"Server error: {str(e)}")
