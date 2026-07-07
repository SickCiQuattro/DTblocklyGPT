import logging
import json
import copy
import time
from collections import Counter
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
# Per-provider keys: keep all set at once and switch providers with LLM_PROVIDER.
# LLM_API_KEY (if set) is an optional override that wins for any provider.
LLM_API_KEY = os.getenv("LLM_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1")
LLM_BASE_URL = os.getenv("LLM_BASE_URL")
LLM_TIMEOUT = int(os.getenv("LLM_TIMEOUT", "30"))
LLM_MAX_RETRIES = int(os.getenv("LLM_MAX_RETRIES", "3"))
CHATGPT_TEMPERATURE = 0.0
# Cap the round-tripped user/assistant history — the task snapshot is already
# re-sent in full every turn via the system prompt, so old turns are only
# needed for conversational continuity, not task state.
MAX_CHAT_HISTORY = 20

logger = logging.getLogger(__name__)


def _scene_summary():
    """Live workspace state for the LLM prompt, aggregated by class+colour.

    Returns e.g. [{"type": "bottle", "color": "blue", "count": 2}] — no
    bboxes, the model only needs what is visible. "unavailable" when the
    vision bridge is down (sim without camera, bridge off): the prompt
    tolerates it.
    """
    from backend.functions.flask_ros_client import FlaskRosClient

    try:
        state = FlaskRosClient().get_vision_state()
    except Exception:
        return "unavailable"
    counts = Counter(
        (d.get("class"), d.get("color"))
        for d in state.get("detections", [])
        if d.get("class")
    )
    return [
        {"type": cls, **({"color": color} if color else {}), "count": n}
        for (cls, color), n in sorted(counts.items(), key=str)
    ]


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
        started_at = time.monotonic()
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
        latency_ms = (time.monotonic() - started_at) * 1000
        usage = getattr(response, "usage", None)
        logger.info(
            "LLM call model=%s latency_ms=%.0f prompt_tokens=%s completion_tokens=%s",
            self.model, latency_ms,
            getattr(usage, "prompt_tokens", None),
            getattr(usage, "completion_tokens", None),
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
    # Resolve the endpoint AND the key per provider, so all keys can stay set at
    # once and you switch providers just by changing LLM_PROVIDER (for A/B tests).
    if LLM_PROVIDER == "gemini":
        api_key = LLM_API_KEY or GEMINI_API_KEY
        base_url = LLM_BASE_URL or "https://generativelanguage.googleapis.com/v1beta/openai/"
    elif LLM_PROVIDER == "openai":
        api_key = LLM_API_KEY or OPENAI_API_KEY
        base_url = LLM_BASE_URL  # None → official OpenAI endpoint
    elif LLM_PROVIDER == "ollama":
        # Ollama exposes an OpenAI-compatible API and needs no real key.
        api_key = LLM_API_KEY or "ollama"
        base_url = LLM_BASE_URL or OLLAMA_BASE_URL
    else:
        raise ValueError(
            f"Provider LLM '{LLM_PROVIDER}' not supported (use gemini, openai or ollama)."
        )

    if not api_key:
        raise ValueError(
            f"No API key for provider '{LLM_PROVIDER}'. Set the matching env var "
            "(GEMINI_API_KEY / OPENAI_API_KEY) or LLM_API_KEY."
        )

    return LLMProvider(
        api_key=api_key,
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
  "taskModified": boolean, // Set to true if you are proposing a new task, making changes, or editing the existing task in response to a user request to modify the workspace. Set to false if the user is only asking a question, asking to analyze the workspace, asking for explanations, or if no changes are being proposed to the workspace.
  "intent": string,       // One of "explain", "analyze", "modify", "evaluate" — see # HOW YOU HELP # below
  "lang": string          // BCP-47 code of the language used in "answer" (e.g. "en-US", "it")
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
- {{"type": "find_object", "objectId": number, "objectName": string}}  // true while the camera sees the object
- {{"type": "gesture", "gestureType": "THUMBS_UP" | "THUMBS_DOWN" | "OPEN_HAND" | "FIST" | "PEACE" | "OK" | "THREE_FINGERS" | "PINCH" | "POINTING"}}  // true when the camera sees that hand gesture
- {{"type": "timer", "seconds": number}}  // true once the given number of seconds has passed
- {{"type": "and", "left": AbstractCondition, "right": AbstractCondition}}  // true only if BOTH inner conditions are true
- {{"type": "or", "left": AbstractCondition, "right": AbstractCondition}}   // true if AT LEAST ONE inner condition is true
- {{"type": "not", "condition": AbstractCondition}}                          // true when the inner condition is false

These are the ONLY valid conditions. Use them for a "when" condition, a "repeat_until" condition, or a "human_action" confirmEvent. You may nest "and"/"or"/"not" to combine conditions (e.g. the camera sees the box AND 5 seconds have passed). NEVER invent other condition types (no "sensor_signal", no "touch_detect").
A "human_action" confirmEvent may additionally be null or {{"type": "human_feedback"}} — both mean "wait for the operator to press confirm" (no sensor).

# BLOCKLY TOOLBOX & CATEGORIES #
These are the blocks available in the visual editor, grouped by the sidebar category the user sees. When you talk to the user, ALWAYS refer to a block by the exact user-facing name shown below (the part in quotes), and when they ask where a block is, tell them which category to open.

{{blocks}}

The "Twin Library" and "Saved Tasks" categories hold pills generated from the user's own data — the objects, locations and skills listed in the # DATABASE # section below, plus their previously saved tasks.
If the user asks where to find a block or how blocks are organized, guide them to these categories by name.

# CONNECTION RULES #
All step blocks can be freely chained in sequence. A condition can ONLY appear as the "condition" of a
"when" step, the "condition" of a "repeat_until" step, or the "confirmEvent" of a "human_action" step —
never on its own as a step in the task array.

# CONTEXT #
- The user is not an expert in robotics or programming.
- The user defines tasks via natural language.
- You must interpret their requests accurately using only the provided database.
- Always use the exact "objectId"/"objectName", "locationId"/"locationName", and "actionId"/"actionName" from the database.
- If the request is ambiguous, incomplete, or references unknown items, respond **only** with a clear natural language question in "answer" asking for clarification and do not modify the task returning the task structure as it is.
- The default language is English. You MUST reply in the language used by the user in their most recent message. If the user writes in English, reply in English. If the user writes in Italian, reply in Italian. Do not default or switch to Italian if the user's latest query is in English, even if previous parts of the chat log contain Italian.
- The user is a beginner. Keep "answer" friendly, concrete and jargon-free. Explain WHY a step is needed, not just what it is. Prefer short sentences.
- Set "lang" to the BCP-47 code of the language you wrote "answer" in (e.g. "en-US" for English, "it" for Italian). It is used to pick the text-to-speech voice.

# HOW YOU HELP — set the "intent" field on every reply #
Decide what the user wants and set "intent" to exactly one of "explain", "analyze", "modify", "evaluate":

- "explain": the user asks what a block does, where to find it, or how something works.
  → Explain it in plain words using the block's user-facing name and its category. Do NOT change the task. "task" = the current snapshot unchanged. taskModified = false.

- "analyze": the user asks what is currently in their workspace ("what's in my task?", "cosa c'è nel workspace?") OR what the camera currently sees ("what do you see?", "quali provette vedi?").
  → For workspace questions, describe the blocks in the # CURRENT TASK SNAPSHOT # in order, in plain words. For camera questions, answer from the "Live camera scene" list only — if it is "unavailable", say the camera is offline; never invent scene contents. Do NOT change anything. "task" = the snapshot unchanged. taskModified = false.

- "modify": the user asks to build, add, remove, or change steps.
  → Return the full updated task in "task" and set taskModified = true. Briefly say what you changed in "answer".

- "evaluate": the user asks you to check, review, judge, or improve their task ("is this good?", "valuta il mio task", "what can I improve?").
  → Give an honest, encouraging assessment in "answer": what works, what is risky or missing (e.g. picking without placing, a "When" with no condition, an object that may be too heavy), and how to fix it. Do NOT change the task unless they explicitly ask. taskModified = false. The app also runs its own automatic checks and shows them next to your assessment.

# SUGGESTIONS — the "messageParts" field (optional) #
Besides "answer", you MAY add short actionable tips as messageParts: a list of {{"type": "suggestion", "content": "..."}} items. Each suggestion is ONE concrete next step in plain language (e.g. "Add a 'Place at' step so the robot puts the object down"). Use them especially for "evaluate" and "explain". Keep each under ~12 words. If you have nothing useful to add, omit messageParts.

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
- Live camera scene (what the robot camera sees RIGHT NOW, aggregated by type and cap colour; "cap" entries are coloured test-tube caps; [] = nothing visible; "unavailable" = camera offline — never invent scene contents): {{scene}}

# EXAMPLES #
User says: "Pick the widget and place it in the bin A."
Response:
{{
  "answer": "I created a task to pick the object 'widget' and place it at 'bin A'.",
  "task": [
      {{"type": "pick", "objectId": 3, "objectName": "widget"}},
      {{"type": "place", "locationId": 2, "locationName": "bin A"}}
    ],
  "taskModified": true,
  "intent": "modify",
  "lang": "en-US"
}}

User says: "Move to the inspection zone then open the gripper."
Response:
{{
  "answer": "I added a move-to step towards the inspection zone followed by an open-gripper step.",
  "task": [
      {{"type": "move_to", "motionType": "LINEAR", "locationId": 5, "locationName": "inspection zone"}},
      {{"type": "gripper", "state": "OPEN"}}
    ],
  "taskModified": true,
  "intent": "modify",
  "lang": "en-US"
}}

User says: "Wait for the operator to put a part on the table before starting."
Response:
{{
  "answer": "I added a 'Pause and show message' step: the robot waits for the operator to confirm before starting.",
  "task": [
      {{"type": "human_action", "description": "Please place the part on the table and confirm.", "confirmEvent": {{"type": "human_feedback"}}}}
    ],
  "taskModified": true,
  "intent": "modify",
  "lang": "en-US"
}}

User says: "Repeat 2 times: pick red_pill and then wait 3 seconds."
Response:
{{
  "answer": "I added a 'Repeat times' loop that runs twice: each time it picks up 'red_pill' and then waits 3 seconds.",
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
  "taskModified": true,
  "intent": "modify",
  "lang": "en-US"
}}

User says: "Keep picking the flask and placing it in the box until the box is no longer in view."
Response:
{{
  "answer": "I added a 'Repeat until' loop: the robot keeps picking 'flask' and placing it at 'box', and stops once the camera no longer sees the box.",
  "task": [
    {{
      "type": "repeat_until",
      "condition": {{"type": "not", "condition": {{"type": "find_object", "objectId": 3, "objectName": "box"}}}},
      "do": [
        {{"type": "pick", "objectId": 4, "objectName": "flask"}},
        {{"type": "place", "locationId": 3, "locationName": "box"}}
      ]
    }}
  ],
  "taskModified": true,
  "intent": "modify",
  "lang": "en-US"
}}

User says: "If the camera sees the widget, pick it up, otherwise wait 5 seconds."
Response:
{{
  "answer": "I added a 'When → Do / Otherwise' block: if the camera sees 'widget' the robot picks it up, otherwise it waits 5 seconds.",
  "task": [
    {{
      "type": "when",
      "condition": {{"type": "find_object", "objectId": 3, "objectName": "widget"}},
      "do": [
        {{"type": "pick", "objectId": 3, "objectName": "widget"}}
      ],
      "otherwise": [
        {{"type": "wait", "seconds": 5}}
      ]
    }}
  ],
  "taskModified": true,
  "intent": "modify",
  "lang": "en-US"
}}

User says: "Only pick the widget when the camera sees it AND you see a thumbs up."
Response:
{{
  "answer": "I added a 'When → Do' block that combines two conditions with AND: the robot picks 'widget' only when the camera sees it and detects a thumbs-up gesture.",
  "task": [
    {{
      "type": "when",
      "condition": {{"type": "and", "left": {{"type": "find_object", "objectId": 3, "objectName": "widget"}}, "right": {{"type": "gesture", "gestureType": "THUMBS_UP"}}}},
      "do": [
        {{"type": "pick", "objectId": 3, "objectName": "widget"}}
      ]
    }}
  ],
  "taskModified": true,
  "intent": "modify",
  "lang": "en-US"
}}

User says: "What does the Pick up block do?"
Response:
{{
  "answer": "'Pick up' tells the robot to grab an object. You drop an item from the 'Twin Library' into it to choose what to pick. You'll find it in the 'Robot Actions' category.",
  "task": [],
  "taskModified": false,
  "intent": "explain",
  "lang": "en-US"
}}

User says: "Is my task any good?" (snapshot: a single 'Pick up' step for 'widget', no place)
Response:
{{
  "answer": "Good start! The robot picks up 'widget', but it never puts it down — it will keep holding it. Add a 'Place at' step to tell it where to set the object.",
  "task": [{{"type": "pick", "objectId": 3, "objectName": "widget"}}],
  "taskModified": false,
  "intent": "evaluate",
  "lang": "en-US",
  "messageParts": [
    {{"type": "suggestion", "content": "Add a 'Place at' step after the pick"}}
  ]
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
                "intent": {
                    "type": "string",
                    "enum": ["explain", "analyze", "modify", "evaluate"],
                    "description": "What the user wants this turn. 'explain' = describe a block/how it works; 'analyze' = describe the current workspace; 'modify' = add/remove/change steps; 'evaluate' = review/judge the task. See the # HOW YOU HELP # section.",
                },
                "lang": {
                    "type": "string",
                    "description": "BCP-47 code of the language you wrote 'answer' in (e.g. 'en-US', 'it'). Used to pick the text-to-speech voice.",
                },
                "messageParts": {
                    "type": "array",
                    "description": "Optional short actionable suggestions shown to the user as chips. Each item is one concrete next step in plain language. Omit if you have nothing useful to add.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "type": {"type": "string", "enum": ["suggestion"]},
                            "content": {"type": "string"},
                        },
                        "required": ["type", "content"],
                    },
                },
            },
            "additionalProperties": False,
            "required": ["answer", "task", "taskModified", "intent", "lang"],
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


def format_blocks_catalog(data_blocks) -> str:
    """Render the block catalog (sent by the frontend from the toolbox registry)
    into the readable list templated into {{blocks}} of the system prompt.

    Keeping the catalog frontend-driven avoids drift: block names and
    descriptions always match what the user actually sees in the toolbox.
    """
    if not data_blocks:
        return "(block catalog unavailable)"
    lines = []
    for idx, category in enumerate(data_blocks, start=1):
        name = category.get("category") or category.get("name") or "?"
        lines.append(f'{idx}. "{name}":')
        for block in category.get("blocks", []):
            label = block.get("label", "?")
            if block.get("dynamic"):
                lines.append(f'   - "{label}": pills generated from your saved items.')
                continue
            desc = block.get("description") or ""
            inputs = block.get("inputs")
            extra = f" (accepts: {inputs})" if inputs and inputs.lower() != "none" else ""
            lines.append(f'   - "{label}": {desc}{extra}')
    return "\n".join(lines)


def validate_condition(condition, cond_index, warnings, data_objects):
    if not isinstance(condition, dict):
        warnings.append({"severity": "error", "message": f"Condition {cond_index}: must be object."})
        return
    cond_type = condition.get("type")
    if cond_type == "find_object":
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
        if not isinstance(condition.get("seconds"), (int, float)) or condition.get("seconds") < 0:
            warnings.append({"severity": "error", "message": f"Condition {cond_index}: invalid seconds."})
    elif cond_type == "human_feedback":
        pass
    elif cond_type in ("and", "or"):
        validate_condition(condition.get("left"), f"{cond_index}.{cond_type}.left", warnings, data_objects)
        validate_condition(condition.get("right"), f"{cond_index}.{cond_type}.right", warnings, data_objects)
    elif cond_type == "not":
        validate_condition(condition.get("condition"), f"{cond_index}.not", warnings, data_objects)
    else:
        warnings.append({"severity": "error", "message": f"Condition {cond_index}: unknown condition type '{cond_type}'."})


def validate_step(step, step_index, warnings, data_objects, data_locations, data_actions):
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
            validate_condition(confirm_event, f"{step_index}.human_action.confirmEvent", warnings, data_objects)

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
            validated_children.append(validate_step(sub_step, f"{step_index}.repeat[{i}]", warnings, data_objects, data_locations, data_actions))
        step_copy["steps"] = validated_children

    elif step_type == "repeat_until":
        condition = step.get("condition")
        steps = step.get("do")
        if not steps:  # fallback if do is None or empty list []
            steps = step.get("steps", [])
        if condition is not None:
            validate_condition(condition, f"{step_index}.repeat_until.condition", warnings, data_objects)
        validated_children = []
        for i, sub_step in enumerate(steps):
            validated_children.append(validate_step(sub_step, f"{step_index}.repeat_until[{i}]", warnings, data_objects, data_locations, data_actions))
        step_copy["do"] = validated_children

    elif step_type == "when":
        condition = step.get("condition")
        do_steps = step.get("do", [])
        otherwise_steps = step.get("otherwise", [])
        if condition is not None:
            validate_condition(condition, f"{step_index}.when.condition", warnings, data_objects)
        validated_do = []
        for i, sub_step in enumerate(do_steps):
            validated_do.append(validate_step(sub_step, f"{step_index}.when.do[{i}]", warnings, data_objects, data_locations, data_actions))
        step_copy["do"] = validated_do
        if otherwise_steps is not None:
            validated_otherwise = []
            for i, sub_step in enumerate(otherwise_steps):
                validated_otherwise.append(validate_step(sub_step, f"{step_index}.when.otherwise[{i}]", warnings, data_objects, data_locations, data_actions))
            step_copy["otherwise"] = validated_otherwise

    else:
        warnings.append({
            "severity": "error",
            "message": f"Step {step_index}: unknown step type '{step_type}'."
        })

    return step_copy


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
                data_blocks = data.get("dataBlocks")

                if message is None:
                    return error_response("Message is required")

                data_result = {}

                replacements = {
                    "{{objects}}": json.dumps(data_objects, ensure_ascii=False),
                    "{{locations}}": json.dumps(data_locations, ensure_ascii=False),
                    "{{actions}}": json.dumps(data_actions, ensure_ascii=False),
                    "{{blocks}}": format_blocks_catalog(data_blocks),
                    "{{scene}}": json.dumps(_scene_summary(), ensure_ascii=False),
                }
                prompt_template = CHATGPT_INSTRUCTIONS_MULTIMODAL
                for placeholder, value in replacements.items():
                    prompt_template = prompt_template.replace(placeholder, value)

                prompt_template += f"\n\n# CURRENT TASK SNAPSHOT #\n{json.dumps(task_structure, ensure_ascii=False)}"

                system_message = {"role": "system", "content": prompt_template}

                # Client only ever needs to round-trip user/assistant turns — drop
                # anything else (e.g. an injected system message) and cap history
                # length before rebuilding the system message fresh every turn.
                chat_log = [
                    msg for msg in (chat_log or [])
                    if isinstance(msg, dict) and msg.get("role") in ("user", "assistant")
                ][-MAX_CHAT_HISTORY:]
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

                    for step_index, step in enumerate(llm_task):
                        validated_task.append(validate_step(step, step_index, validation_warnings, data_objects, data_locations, data_actions))

                    message_parts = []
                    if answer:
                        message_parts.append({"type": "text", "content": answer})

                    # LLM-provided actionable suggestions (shown as chips).
                    for part in (response_json.get("messageParts") or []):
                        if isinstance(part, dict) and part.get("type") == "suggestion" and part.get("content"):
                            message_parts.append({"type": "suggestion", "content": str(part["content"])})

                    frontend_warnings = [w["message"] for w in validation_warnings]
                    for warning_msg in frontend_warnings:
                        message_parts.append({"type": "warning", "content": warning_msg})

                    # Store a compact assistant turn in history — the full "task"
                    # is dropped since the # CURRENT TASK SNAPSHOT # already carries
                    # it fresh on every turn; keeping it here would just double the
                    # tokens spent on it in every subsequent call.
                    chat_log.append({"role": "assistant", "content": json.dumps({
                        "answer": answer,
                        "intent": response_json.get("intent"),
                        "taskModified": response_json.get("taskModified"),
                    })})

                    is_valid = not any(w["severity"] == "error" for w in validation_warnings)
                    task_modified = response_json.get("taskModified", True)
                    requires_confirmation = task_modified and len(validated_task) > 0 and is_valid

                    data_result = {
                        "messageParts": message_parts,
                        "proposedTask": validated_task if requires_confirmation else None,
                        "requiresConfirmation": requires_confirmation,
                        "validationWarnings": frontend_warnings,
                        "isValid": is_valid,
                        # Drop the system message (full prompt + DB dump) — the
                        # server rebuilds it every turn, no need to round-trip it.
                        "chatLog": [m for m in chat_log if m["role"] != "system"],
                        "intent": response_json.get("intent"),
                        "response": {
                            "answer": answer,
                            "task": validated_task if requires_confirmation else None,
                            "taskModified": task_modified,
                            "intent": response_json.get("intent"),
                            "lang": response_json.get("lang"),
                            "finished": False,
                            "validationWarnings": frontend_warnings,
                        },
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
                    }

                return success_response(data_result)
            else:
                return invalid_request_method()
        else:
            return unauthorized_request()
    except Exception as e:
        logger.exception("Exception in new_message_multimodal")
        return error_response(f"Server error: {str(e)}")
