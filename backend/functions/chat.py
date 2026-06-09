import json
import copy
from django.http import HttpResponse, HttpRequest
from backend.utils.response import (
    HttpMethod,
    invalid_request_method,
    error_response,
    success_response,
    unauthorized_request,
)
from json import loads, dumps
from openai import OpenAI
from dataclasses import dataclass
from typing import List, Union, Optional, Literal

from backend.models import Task, Object, Action, Location
from backend.utils.date import getDateTimeNow
from django.db.models import Q
from django.contrib.auth.models import User
from enum import Enum
from typing import Tuple
from backend.block_types import EventsItems, LibrariesItems, LogicItems, StepsItems
from .schemas import MessagePart, AbstractCondition, AbstractStep, LLMResponse, ChatApiResponse
import os

LLM_PROVIDER = os.getenv("LLM_PROVIDER", "gemini").lower()
LLM_MODEL = os.getenv("LLM_MODEL", "gemini-2.5-flash")
LLM_API_KEY = os.getenv("LLM_API_KEY") or os.getenv("GEMINI_API_KEY") or os.getenv("OPENAI_API_KEY")
LLM_BASE_URL = os.getenv("LLM_BASE_URL")
LLM_TIMEOUT = int(os.getenv("LLM_TIMEOUT", "30"))
LLM_MAX_RETRIES = int(os.getenv("LLM_MAX_RETRIES", "3"))
CHATGPT_TEMPERATURE = 0.0

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional, List, Dict, Any

@dataclass
class ProviderLLMResponse:
    answer: str                    # Testo naturale estratto
    raw_arguments: dict            # Argomenti della tool call parsati
    raw_response: object           # Risposta originale del client per debug

class BaseLLMProvider(ABC):
    @abstractmethod
    def complete(
        self,
        messages: List[Dict[str, Any]],
        tools: List[Dict[str, Any]],
        tool_name: str,
        temperature: float = 0.0,
    ) -> ProviderLLMResponse:
        pass
    
    @abstractmethod
    def supports_tool_calling(self) -> bool:
        pass

class GeminiProvider(BaseLLMProvider):
    def __init__(self, api_key: str, base_url: str = None, model: str = "gemini-2.5-flash", timeout: int = 30, max_retries: int = 3):
        self.api_key = api_key
        self.base_url = base_url or "https://generativelanguage.googleapis.com/v1beta/openai/"
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

    def supports_tool_calling(self) -> bool:
        return True

class OpenAIProvider(BaseLLMProvider):
    def __init__(self, api_key: str, base_url: str = None, model: str = "gpt-4o", timeout: int = 30, max_retries: int = 3):
        self.api_key = api_key
        self.base_url = base_url  # can be None for official openai endpoint
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

    def supports_tool_calling(self) -> bool:
        return True

class LocalLlamaProvider(BaseLLMProvider):
    def complete(self, messages: List[Dict[str, Any]], tools: List[Dict[str, Any]], tool_name: str, temperature: float = 0.0) -> ProviderLLMResponse:
        raise NotImplementedError("LocalLlamaProvider not yet implemented.")

    def supports_tool_calling(self) -> bool:
        return False

def get_llm_provider() -> BaseLLMProvider:
    if not LLM_API_KEY:
        raise ValueError("API LLM Key not found in environment variables.")
    
    if LLM_PROVIDER == "gemini":
        return GeminiProvider(
            api_key=LLM_API_KEY,
            base_url=LLM_BASE_URL,
            model=LLM_MODEL,
            timeout=LLM_TIMEOUT,
            max_retries=LLM_MAX_RETRIES
        )
    elif LLM_PROVIDER == "openai":
        return OpenAIProvider(
            api_key=LLM_API_KEY,
            base_url=LLM_BASE_URL,
            model=LLM_MODEL,
            timeout=LLM_TIMEOUT,
            max_retries=LLM_MAX_RETRIES
        )
    elif LLM_PROVIDER == "local":
        return LocalLlamaProvider()
    else:
        raise ValueError(f"Provider LLM '{LLM_PROVIDER}' not supported.")

CHATGPT_INSTRUCTIONS = """
You are an assistant designed to extract intent from text. You must drive the user to define a Pick-and-Place task for a collaborative robot providing to him/her the details to be defined before he/she asks for them.
Do not include any explanations, just provide an RFC8259 compliant JSON response that follows this format without deviation:
{
    answer: string,
    task: {
        program: {
            control: {
                control_type: string | null,
                times: number | null,
                event: {
                    event_type: string | null,
                    find_object: string | null,
                },
                otherwise: {
                    otherwise_pick: {
                        object: string | null
                    },
                    otherwise_processing: {
                    action: string | null
                    },
                    otherwise_place: {
                        location: string | null
                    },
                },
                control_pick: {
                    object: string | null
                },
                control_processing: {
                    action: string | null
                },
                control_place: {
                    location: string | null
                },
            },
            pick: {
                object: string | null
            },
            processing: {
                action: string | null
            },
            place: {
                location: string | null
            }
        }
    },
    finished: boolean
}
IMPORTANT: the 'answer' field is mandatory and must be filled with a string.

Explaination of the context:
- The user is not a roboticist or IT expert and he/she needs to create a task for a cobot to help him/her define pick and place tasks.
- To define a task, the user has to specify the pick object and the place location. The user can also specify an action to be performed on the object.
- The user can also specify a control intent to define a condition to be satisfied before the pick and place task can be executed.

Resume specifications:
- When you have collected all the information, you need to present a resume of the task you have just created to the user.
- You must ask to the user to confirm the summary or ask for changes.
- If the user wants to make changes, you must ask the modifications required and propose the updated resume asking again to check it.

Conclusion specifications:
- Only after the user has approved the resume, you must set to true the 'finished' property in the JSON.

General instructions:
- You can't left empty the 'answer' field.
- The 'answer' field in the JSON is your natural language response to the user. If you're unsure of an answer, you can ask the user to repeat the request.
"""

CHATGPT_USE_FUNCTIONS = "Only use the tool you have been provided with."
CHATGPT_ALWAYS_REPLY = "Always reply to the user. You can't left the property 'answer' blank. If you're unsure of an answer, you can ask the user to repeat the request."

CHATGPT_FUNCTION = {
    "type": "function",
    "function": {
        "name": "parse_chatgpt_response",
        "description": "Process response from chatgpt to digest information",
        "parameters": {
            "type": "object",
            "properties": {
                "answer": {
                    "type": "string",
                    "description": "Model response to the user",
                },
                "task": {
                    "type": "object",
                    "properties": {
                        "program": {
                            "type": "object",
                            "properties": {
                                "control": {
                                    "type": "object",
                                    "properties": {
                                        "control_type": {
                                            "type": "string",
                                            "enum": [
                                                "repeat",
                                                "loop",
                                                "when",
                                                "when_otherwise",
                                                # "stop_when",
                                                # "do_when",
                                            ],
                                            "description": "The control type of the control intent.",
                                        },
                                        "times": {
                                            "type": "integer",
                                            "description": "The times of repetition in the case of repeat control type.",
                                        },
                                        "otherwise": {
                                            "type": "object",
                                            "properties": {
                                                "otherwise_pick": {
                                                    "type": "object",
                                                    "properties": {
                                                        "object": {
                                                            "type": "string",
                                                            "description": "The object of the pick intent.",
                                                        }
                                                    },
                                                    "required": ["object"],
                                                },
                                                "otherwise_processing": {
                                                    "type": "object",
                                                    "properties": {
                                                        "action": {
                                                            "type": "string",
                                                            "description": "The action of the action intent.",
                                                        }
                                                    },
                                                    "required": ["action"],
                                                },
                                                "otherwise_place": {
                                                    "type": "object",
                                                    "properties": {
                                                        "location": {
                                                            "type": "string",
                                                            "description": "The location of the place intent.",
                                                        }
                                                    },
                                                    "required": ["location"],
                                                },
                                            },
                                            # "required": ["pick", "place"],
                                            "required": ["otherwise_pick", "otherwise_place"],
                                        },
                                        "event": {
                                            "type": "object",
                                            "properties": {
                                                "event_type": {
                                                    "type": "string",
                                                    "enum": ["sensor", "find", "human"],
                                                    # "enum": ["detect", "sensor", "find", "human"],
                                                    "description": "The event type of the event intent.",
                                                },
                                                "find_object": {
                                                    "type": "string",
                                                    "description": "Object to find in the case of find event type.",
                                                },
                                            },
                                            "required": ["event_type"],
                                        },
                                        "control_pick": {
                                            "type": "object",
                                            "properties": {
                                                "object": {
                                                    "type": "string",
                                                    "description": "The object of the pick intent.",
                                                }
                                            },
                                            "required": ["object"],
                                        },
                                        "control_processing": {
                                            "type": "object",
                                            "properties": {
                                                "action": {
                                                    "type": "string",
                                                    "description": "The action of the action intent.",
                                                }
                                            },
                                            "required": ["action"],
                                        },
                                        "control_place": {
                                            "type": "object",
                                            "properties": {
                                                "location": {
                                                    "type": "string",
                                                    "description": "The location of the place intent.",
                                                }
                                            },
                                            "required": ["location"],
                                        },
                                    },
                                    "required": ["control_type"],
                                },
                                "pick": {
                                    "type": "object",
                                    "properties": {
                                        "object": {
                                            "type": "string",
                                            "description": "The object of the pick intent.",
                                        }
                                    },
                                    "required": ["object"],
                                },
                                "processing": {
                                    "type": "object",
                                    "properties": {
                                        "action": {
                                            "type": "string",
                                            "description": "The action of the action intent.",
                                        }
                                    },
                                    "required": ["action"],
                                },
                                "place": {
                                    "type": "object",
                                    "properties": {
                                        "location": {
                                            "type": "string",
                                            "description": "The location of the place intent.",
                                        }
                                    },
                                    "required": ["location"],
                                },
                            },
                            "required": ["control", "pick", "processing", "place"],
                        }
                    },
                    "required": ["program"],
                },
                "finished": {
                    "type": "boolean",
                    "description": "The finished intent after the user has approved the resume",
                },
            },
            "required": ["answer", "task", "finished"],
        },
    },
}

CHATGPT_ERROR = "A problem occurred while creating the new message. Please try again."


def new_message(request: HttpRequest) -> HttpResponse:
    try:
        if request.user.is_authenticated:
            if request.method == HttpMethod.POST.value:
                data = loads(request.body)
                message = data.get("message")
                chat_log = data.get("chatLog")
                fine_tuned_model = data.get("fineTunedModel")
                fine_tuning_job_id = data.get("fineTuningJobId")

                data_result = {}

                # Init the conversation
                if chat_log is None or len(chat_log) == 0:
                    """
                    # Check fine-tuned model
                    try:
                        job = openai.FineTuningJob.retrieve(fine_tuning_job_id)
                        fine_tuned_model = job["fine_tuned_model"]
                    except Exception:
                        job = None

                    if job is None:
                        file_path = path.join(
                            path.dirname(path.dirname(path.abspath(__file__))),
                            "functions",
                            "fine_tuning_tasks.jsonl",
                        )
                        file = openai.File.create(
                            file=open(file_path, "rb"),
                            purpose="fine-tune",
                        )

                        job = openai.FineTuningJob.create(
                            training_file=file["id"],
                            model="gpt-3.5-turbo",
                            suffix="DTblocklyGPT-tasks",
                        )

                        fine_tuning_job_id = job["id"]
                        fine_tuned_model = job["fine_tuned_model"]
                        print("NEW MODEL CREATED")
                        print("Model ID: " + fine_tuned_model)
                        print("Job ID: " + fine_tuning_job_id)
                    """
                    chat_log = [
                        {
                            "role": "system",
                            "content": CHATGPT_INSTRUCTIONS,
                        },
                        {"role": "system", "content": CHATGPT_USE_FUNCTIONS},
                        {"role": "system", "content": CHATGPT_ALWAYS_REPLY},
                    ]

                chat_log.append({"role": "user", "content": message})
                provider = get_llm_provider()
                llm_response = provider.complete(
                    messages=chat_log,
                    tools=[CHATGPT_FUNCTION],
                    tool_name=CHATGPT_FUNCTION["function"]["name"],
                    temperature=CHATGPT_TEMPERATURE
                )
                response_json = llm_response.raw_arguments

                try:
                    answer = response_json.get("answer", "")

                    if answer:
                        chat_log.append({"role": "assistant", "content": answer})

                    # Response has the "answer" field blank
                    i = 0
                    while not answer:
                        if i > 2:
                            forced_answer = "Ok! Let's go ahead."
                            chat_log.append(
                                {"role": "assistant", "content": forced_answer}
                            )
                            break

                        chat_log.append(
                            {"role": "system", "content": CHATGPT_ALWAYS_REPLY}
                        )
                        llm_response = provider.complete(
                            messages=chat_log,
                            tools=[CHATGPT_FUNCTION],
                            tool_name=CHATGPT_FUNCTION["function"]["name"],
                            temperature=CHATGPT_TEMPERATURE
                        )
                        response_json = llm_response.raw_arguments
                        answer = response_json.get("answer", "")
                        i += 1

                except Exception as inner_e:
                    print("Inner chat parse error:", inner_e)
                    data_result["answer"] = CHATGPT_ERROR

                data_result["chatLog"] = chat_log
                data_result["response"] = response_json
                data_result["fineTunedModel"] = fine_tuned_model
                data_result["fineTuningJobId"] = fine_tuning_job_id
                return success_response(data_result)
            else:
                return invalid_request_method()
        else:
            return unauthorized_request()
    except Exception as e:
        print(e)
        return error_response(CHATGPT_ERROR)


# Alias for chat-side logic: kept for local readability
class ChatLogicItems(Enum):
    REPEAT = "repeat"
    LOOP = "loop"
    WHEN_OTHERWISE = "when_otherwise"
    WHEN = "when"


class ChatEventItems(Enum):
    SENSOR = "sensor"
    FIND = "find"
    HUMAN = "human"


def save_chat_task(request: HttpRequest) -> HttpResponse:
    try:
        if request.user.is_authenticated:
            if request.method == HttpMethod.POST.value:
                user = User.objects.get(id=request.user.id)
                data = loads(request.body)
                task_id = data.get("id")
                taskStructure = data.get("taskStructure")

                taskCode = {}

                # Repeat and Loop
                if (
                    taskStructure["program"]["control"]["control_type"]
                    == ChatLogicItems.REPEAT.value
                    or taskStructure["program"]["control"]["control_type"]
                    == ChatLogicItems.LOOP.value
                ):
                    if (
                        taskStructure["program"]["control"]["control_type"]
                        == ChatLogicItems.REPEAT.value
                    ):
                        taskCode = {
                            "type": LogicItems.REPEAT.value,
                            "fields": {
                                "times": taskStructure["program"]["control"]["times"]
                            },
                        }
                    else:
                        taskCode = {
                            "type": LogicItems.LOOP.value,
                        }

                    object_name_to_search = None
                    _ctrl_pick = taskStructure["program"]["control"].get("control_pick") or {}
                    if _ctrl_pick.get("object"):
                        object_name_to_search = _ctrl_pick["object"]
                    else:
                        object_name_to_search = (taskStructure["program"].get("pick") or {}).get("object")

                    object_id, object_name, object_keywords = search_existing_libraries(
                        user,
                        Object,
                        object_name_to_search,
                    )

                    location_name_to_search = None
                    _ctrl_place = taskStructure["program"]["control"].get("control_place") or {}
                    if _ctrl_place.get("location"):
                        location_name_to_search = _ctrl_place["location"]
                    else:
                        location_name_to_search = (taskStructure["program"].get("place") or {}).get("location")
                    (
                        location_id,
                        location_name,
                        location_keywords,
                    ) = search_existing_libraries(
                        user, Location, location_name_to_search
                    )

                    _ctrl_proc = taskStructure["program"]["control"].get("control_processing") or {}
                    _proc = taskStructure["program"].get("processing") or {}
                    _ctrl_action = _ctrl_proc.get("action")
                    _proc_action = _proc.get("action")
                    if _ctrl_action or _proc_action:
                        action_name_to_search = _ctrl_action or _proc_action
                        (
                            action_id,
                            action_name,
                            action_keywords,
                        ) = search_existing_libraries(
                            user,
                            Action,
                            action_name_to_search,
                        )
                        taskCode["inputs"] = {
                            "DO": {
                                "block": {
                                    "type": StepsItems.PICK.value,
                                    "inputs": {
                                        "OBJECT": {
                                            "block": {
                                                "type": LibrariesItems.OBJECT.value,
                                                "data": dumps(
                                                    {
                                                        "id": object_id,
                                                        "name": object_name,
                                                        "keywords": object_keywords,
                                                    }
                                                ),
                                                "fields": {"name": object_name},
                                            }
                                        }
                                    },
                                    "next": {
                                        "block": {
                                            "type": StepsItems.PROCESSING.value,
                                            "inputs": {
                                                "ACTION": {
                                                    "block": {
                                                        "type": LibrariesItems.ACTION.value,
                                                        "data": dumps(
                                                            {
                                                                "id": action_id,
                                                                "name": action_name,
                                                                "keywords": action_keywords,
                                                            }
                                                        ),
                                                        "fields": {"name": action_name},
                                                    }
                                                }
                                            },
                                            "next": {
                                                "block": {
                                                    "type": StepsItems.PLACE.value,
                                                    "inputs": {
                                                        "LOCATION": {
                                                            "block": {
                                                                "type": LibrariesItems.LOCATION.value,
                                                                "data": dumps(
                                                                    {
                                                                        "id": location_id,
                                                                        "name": location_name,
                                                                        "keywords": location_keywords,
                                                                    }
                                                                ),
                                                                "fields": {
                                                                    "name": location_name
                                                                },
                                                            }
                                                        }
                                                    },
                                                }
                                            },
                                        }
                                    },
                                }
                            }
                        }
                    else:
                        taskCode["inputs"] = {
                            "DO": {
                                "block": {
                                    "type": StepsItems.PICK.value,
                                    "inputs": {
                                        "OBJECT": {
                                            "block": {
                                                "type": LibrariesItems.OBJECT.value,
                                                "data": dumps(
                                                    {
                                                        "id": object_id,
                                                        "name": object_name,
                                                        "keywords": object_keywords,
                                                    }
                                                ),
                                                "fields": {"name": object_name},
                                            }
                                        }
                                    },
                                    "next": {
                                        "block": {
                                            "type": StepsItems.PLACE.value,
                                            "inputs": {
                                                "LOCATION": {
                                                    "block": {
                                                        "type": LibrariesItems.LOCATION.value,
                                                        "data": dumps(
                                                            {
                                                                "id": location_id,
                                                                "name": location_name,
                                                                "keywords": location_keywords,
                                                            }
                                                        ),
                                                        "fields": {
                                                            "name": location_name
                                                        },
                                                    }
                                                }
                                            },
                                        }
                                    },
                                }
                            }
                        }

                # When and When-Otherwise
                elif (
                    taskStructure["program"]["control"]["control_type"]
                    == ChatLogicItems.WHEN.value
                    or taskStructure["program"]["control"]["control_type"]
                    == ChatLogicItems.WHEN_OTHERWISE.value
                ):
                    # Control type
                    if (
                        taskStructure["program"]["control"]["control_type"]
                        == ChatLogicItems.WHEN.value
                    ):
                        taskCode = {
                            "type": LogicItems.WHEN.value,
                        }
                    else:
                        taskCode = {
                            "type": LogicItems.WHEN_OTHERWISE.value,
                        }

                    # Event type
                    # if (
                    #     taskStructure["program"]["control"]["event"]["event_type"]
                    #     == ChatEventItems.DETECT.value
                    # ):
                    #     taskCode["inputs"] = {
                    #         "WHEN": {
                    #             "block": {
                    #                 "type": EventsItems.DETECT.value,
                    #             }
                    #         }
                    #     }

                    if (
                        taskStructure["program"]["control"]["event"]["event_type"]
                        == ChatEventItems.SENSOR.value
                    ):
                        taskCode["inputs"] = {
                            "WHEN": {
                                "block": {
                                    "type": EventsItems.SENSOR.value,
                                }
                            }
                        }
                    elif (
                        taskStructure["program"]["control"]["event"]["event_type"]
                        == ChatEventItems.HUMAN.value
                    ):
                        taskCode["inputs"] = {
                            "WHEN": {
                                "block": {
                                    "type": EventsItems.HUMAN.value,
                                }
                            }
                        }
                    elif (
                        taskStructure["program"]["control"]["event"]["event_type"]
                        == ChatEventItems.FIND.value
                    ):
                        (
                            object_to_find_id,
                            object_to_find_name,
                            object_to_find_keywords,
                        ) = search_existing_libraries(
                            user,
                            Object,
                            taskStructure["program"]["control"]["event"]["find_object"],
                        )

                        taskCode["inputs"] = {
                            "WHEN": {
                                "block": {
                                    "type": EventsItems.FIND.value,
                                    "inputs": {
                                        "OBJECT": {
                                            "block": {
                                                "type": LibrariesItems.OBJECT.value,
                                            },
                                            "data": dumps(
                                                {
                                                    "id": object_to_find_id,
                                                    "name": object_to_find_name,
                                                    "keywords": object_to_find_keywords,
                                                }
                                            ),
                                            "fields": {"name": object_to_find_name},
                                        }
                                    },
                                }
                            }
                        }

                    object_name_to_search = None
                    if (
                        taskStructure["program"]["control"]["control_pick"]["object"]
                        is not None
                    ):
                        object_name_to_search = taskStructure["program"]["control"][
                            "control_pick"
                        ]["object"]
                    else:
                        object_name_to_search = taskStructure["program"]["pick"][
                            "object"
                        ]

                    object_id, object_name, object_keywords = search_existing_libraries(
                        user,
                        Object,
                        object_name_to_search,
                    )

                    location_name_to_search = None
                    if (
                        taskStructure["program"]["control"]["control_place"]["location"]
                        is not None
                    ):
                        location_name_to_search = taskStructure["program"]["control"][
                            "control_place"
                        ]["location"]
                    else:
                        location_name_to_search = taskStructure["program"]["place"][
                            "location"
                        ]
                    (
                        location_id,
                        location_name,
                        location_keywords,
                    ) = search_existing_libraries(
                        user, Location, location_name_to_search
                    )

                    if (
                        taskStructure["program"]["control"]["control_processing"][
                            "action"
                        ]
                        is not None
                        or taskStructure["program"]["processing"]["action"] is not None
                    ):
                        action_name_to_search = None
                        if (
                            taskStructure["program"]["control"]["control_processing"][
                                "action"
                            ]
                            is not None
                        ):
                            action_name_to_search = taskStructure["program"]["control"][
                                "control_processing"
                            ]["action"]
                        else:
                            action_name_to_search = taskStructure["program"][
                                "processing"
                            ]["action"]
                        (
                            action_id,
                            action_name,
                            action_keywords,
                        ) = search_existing_libraries(
                            user,
                            Action,
                            action_name_to_search,
                        )
                        taskCode["inputs"].update(
                            {
                                "DO": {
                                    "block": {
                                        "type": StepsItems.PICK.value,
                                        "inputs": {
                                            "OBJECT": {
                                                "block": {
                                                    "type": LibrariesItems.OBJECT.value,
                                                    "data": dumps(
                                                        {
                                                            "id": object_id,
                                                            "name": object_name,
                                                            "keywords": object_keywords,
                                                        }
                                                    ),
                                                    "fields": {"name": object_name},
                                                }
                                            }
                                        },
                                        "next": {
                                            "block": {
                                                "type": StepsItems.PROCESSING.value,
                                                "inputs": {
                                                    "ACTION": {
                                                        "block": {
                                                            "type": LibrariesItems.ACTION.value,
                                                            "data": dumps(
                                                                {
                                                                    "id": action_id,
                                                                    "name": action_name,
                                                                    "keywords": action_keywords,
                                                                }
                                                            ),
                                                            "fields": {
                                                                "name": action_name
                                                            },
                                                        }
                                                    }
                                                },
                                                "next": {
                                                    "block": {
                                                        "type": StepsItems.PLACE.value,
                                                        "inputs": {
                                                            "LOCATION": {
                                                                "block": {
                                                                    "type": LibrariesItems.LOCATION.value,
                                                                    "data": dumps(
                                                                        {
                                                                            "id": location_id,
                                                                            "name": location_name,
                                                                            "keywords": location_keywords,
                                                                        }
                                                                    ),
                                                                    "fields": {
                                                                        "name": location_name
                                                                    },
                                                                }
                                                            }
                                                        },
                                                    }
                                                },
                                            }
                                        },
                                    }
                                }
                            }
                        )
                    else:
                        taskCode["inputs"].update(
                            {
                                "DO": {
                                    "block": {
                                        "type": StepsItems.PICK.value,
                                        "inputs": {
                                            "OBJECT": {
                                                "block": {
                                                    "type": LibrariesItems.OBJECT.value,
                                                    "data": dumps(
                                                        {
                                                            "id": object_id,
                                                            "name": object_name,
                                                            "keywords": object_keywords,
                                                        }
                                                    ),
                                                    "fields": {"name": object_name},
                                                }
                                            }
                                        },
                                        "next": {
                                            "block": {
                                                "type": StepsItems.PLACE.value,
                                                "inputs": {
                                                    "LOCATION": {
                                                        "block": {
                                                            "type": LibrariesItems.LOCATION.value,
                                                            "data": dumps(
                                                                {
                                                                    "id": location_id,
                                                                    "name": location_name,
                                                                    "keywords": location_keywords,
                                                                }
                                                            ),
                                                            "fields": {
                                                                "name": location_name
                                                            },
                                                        }
                                                    }
                                                },
                                            }
                                        },
                                    }
                                }
                            }
                        )

                    # Otherwise
                    if (
                        taskStructure["program"]["control"]["control_type"]
                        == ChatLogicItems.WHEN_OTHERWISE.value
                    ):
                        (
                            object_otherwise_id,
                            object_otherwise_name,
                            object_otherwise_keywords,
                        ) = search_existing_libraries(
                            user,
                            Object,
                            taskStructure["program"]["control"]["otherwise"][
                                "otherwise_pick"
                            ]["object"],
                        )

                        (
                            location_otherwise_id,
                            location_otherwise_name,
                            location_otherwise_keywords,
                        ) = search_existing_libraries(
                            user,
                            Location,
                            taskStructure["program"]["control"]["otherwise"][
                                "otherwise_place"
                            ]["location"],
                        )

                        if (
                            taskStructure["program"]["control"]["otherwise"][
                                "otherwise_processing"
                            ]
                            is not None
                            and taskStructure["program"]["control"]["otherwise"][
                                "otherwise_processing"
                            ]["action"]
                        ):
                            (
                                action_otherwise_id,
                                action_otherwise_name,
                                action_otherwise_keywords,
                            ) = search_existing_libraries(
                                user,
                                Action,
                                taskStructure["program"]["control"]["otherwise"][
                                    "otherwise_processing"
                                ]["action"],
                            )
                            taskCode["inputs"].update(
                                {
                                    "OTHERWISE": {
                                        "block": {
                                            "type": StepsItems.PICK.value,
                                            "inputs": {
                                                "OBJECT": {
                                                    "block": {
                                                        "type": LibrariesItems.OBJECT.value,
                                                        "data": dumps(
                                                            {
                                                                "id": object_otherwise_id,
                                                                "name": object_otherwise_name,
                                                                "keywords": object_otherwise_keywords,
                                                            }
                                                        ),
                                                        "fields": {
                                                            "name": object_otherwise_name
                                                        },
                                                    }
                                                }
                                            },
                                            "next": {
                                                "block": {
                                                    "type": StepsItems.PROCESSING.value,
                                                    "inputs": {
                                                        "ACTION": {
                                                            "block": {
                                                                "type": LibrariesItems.ACTION.value,
                                                                "data": dumps(
                                                                    {
                                                                        "id": action_otherwise_id,
                                                                        "name": action_otherwise_name,
                                                                        "keywords": action_otherwise_keywords,
                                                                    }
                                                                ),
                                                                "fields": {
                                                                    "name": action_otherwise_name
                                                                },
                                                            }
                                                        }
                                                    },
                                                    "next": {
                                                        "block": {
                                                            "type": StepsItems.PLACE.value,
                                                            "inputs": {
                                                                "LOCATION": {
                                                                    "block": {
                                                                        "type": LibrariesItems.LOCATION.value,
                                                                        "data": dumps(
                                                                            {
                                                                                "id": location_otherwise_id,
                                                                                "name": location_otherwise_name,
                                                                                "keywords": location_otherwise_keywords,
                                                                            }
                                                                        ),
                                                                        "fields": {
                                                                            "name": location_otherwise_name
                                                                        },
                                                                    }
                                                                }
                                                            },
                                                        }
                                                    },
                                                }
                                            },
                                        }
                                    }
                                }
                            )
                        else:
                            taskCode["inputs"].update(
                                {
                                    "OTHERWISE": {
                                        "block": {
                                            "type": StepsItems.PICK.value,
                                            "inputs": {
                                                "OBJECT": {
                                                    "block": {
                                                        "type": LibrariesItems.OBJECT.value,
                                                        "data": dumps(
                                                            {
                                                                "id": object_otherwise_id,
                                                                "name": object_otherwise_name,
                                                                "keywords": object_otherwise_keywords,
                                                            }
                                                        ),
                                                        "fields": {
                                                            "name": object_otherwise_name
                                                        },
                                                    }
                                                }
                                            },
                                            "next": {
                                                "block": {
                                                    "type": StepsItems.PLACE.value,
                                                    "inputs": {
                                                        "LOCATION": {
                                                            "block": {
                                                                "type": LibrariesItems.LOCATION.value,
                                                                "data": dumps(
                                                                    {
                                                                        "id": location_otherwise_id,
                                                                        "name": location_otherwise_name,
                                                                        "keywords": location_otherwise_keywords,
                                                                    }
                                                                ),
                                                                "fields": {
                                                                    "name": location_otherwise_name
                                                                },
                                                            }
                                                        }
                                                    },
                                                }
                                            },
                                        }
                                    }
                                }
                            )

                # No controls
                elif taskStructure["program"]["control"]["control_type"] is None:
                    object_id, object_name, object_keywords = search_existing_libraries(
                        user,
                        Object,
                        taskStructure["program"]["pick"]["object"],
                    )

                    (
                        location_id,
                        location_name,
                        location_keywords,
                    ) = search_existing_libraries(
                        user,
                        Location,
                        taskStructure["program"]["place"]["location"],
                    )

                    taskCode = {
                        "type": StepsItems.PICK.value,
                    }

                    if (
                        taskStructure["program"]["processing"] is not None
                        and taskStructure["program"]["processing"]["action"]
                    ):
                        (
                            action_id,
                            action_name,
                            action_keywords,
                        ) = search_existing_libraries(
                            user,
                            Action,
                            taskStructure["program"]["processing"]["action"],
                        )
                        taskCode["inputs"] = {
                            "OBJECT": {
                                "block": {
                                    "type": LibrariesItems.OBJECT.value,
                                    "data": dumps(
                                        {
                                            "id": object_id,
                                            "name": object_name,
                                            "keywords": object_keywords,
                                        }
                                    ),
                                    "fields": {"name": object_name},
                                }
                            },
                        }
                        taskCode["next"] = {
                            "block": {
                                "type": StepsItems.PROCESSING.value,
                                "inputs": {
                                    "ACTION": {
                                        "block": {
                                            "type": LibrariesItems.ACTION.value,
                                            "data": dumps(
                                                {
                                                    "id": action_id,
                                                    "name": action_name,
                                                    "keywords": action_keywords,
                                                }
                                            ),
                                            "fields": {"name": action_name},
                                        }
                                    }
                                },
                                "next": {
                                    "block": {
                                        "type": StepsItems.PLACE.value,
                                        "inputs": {
                                            "LOCATION": {
                                                "block": {
                                                    "type": LibrariesItems.LOCATION.value,
                                                    "data": dumps(
                                                        {
                                                            "id": location_id,
                                                            "name": location_name,
                                                            "keywords": location_keywords,
                                                        }
                                                    ),
                                                    "fields": {"name": location_name},
                                                }
                                            }
                                        },
                                    }
                                },
                            },
                        }
                    else:
                        taskCode["inputs"] = {
                            "OBJECT": {
                                "block": {
                                    "type": LibrariesItems.OBJECT.value,
                                    "data": dumps(
                                        {
                                            "id": object_id,
                                            "name": object_name,
                                            "keywords": object_keywords,
                                        }
                                    ),
                                    "fields": {"name": object_name},
                                }
                            },
                        }
                        taskCode["next"] = {
                            "block": {
                                "type": StepsItems.PLACE.value,
                                "inputs": {
                                    "LOCATION": {
                                        "block": {
                                            "type": LibrariesItems.LOCATION.value,
                                            "data": dumps(
                                                {
                                                    "id": location_id,
                                                    "name": location_name,
                                                    "keywords": location_keywords,
                                                }
                                            ),
                                            "fields": {"name": location_name},
                                        }
                                    }
                                },
                            },
                        }

                date = getDateTimeNow()

                Task.objects.filter(id=task_id).update(
                    code=dumps(taskCode),
                    last_modified=date,
                )

                response = {
                    "taskCode": taskCode,
                }
                return success_response(response)
            else:
                return invalid_request_method()
        else:
            return unauthorized_request()
    except Exception as e:
        return error_response(str(e))


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


from dataclasses import dataclass
from typing import List, Union, Optional, Literal



@dataclass
class SensorSignalCondition:
    type: Literal["sensor_signal"]
    sensor: str


@dataclass
class FindObjectCondition:
    type: Literal["find_object"]
    objectId: int
    objectName: str


@dataclass
class HumanFeedbackCondition:
    type: Literal["human_feedback"]


@dataclass
class TouchDetectCondition:
    type: Literal["touch_detect"]


@dataclass
class GestureCondition:
    type: Literal["gesture"]
    gestureType: str  # "THUMBS_UP" | "STOP" | "OPEN_HAND"


@dataclass
class TimerCondition:
    type: Literal["timer"]
    seconds: int


AbstractCondition = Union[
    SensorSignalCondition,
    FindObjectCondition,
    HumanFeedbackCondition,
    TouchDetectCondition,
    GestureCondition,
    TimerCondition,
]


@dataclass
class AbstractPickStep:
    type: Literal["pick"]
    objectId: int
    objectName: str


@dataclass
class AbstractPlaceStep:
    type: Literal["place"]
    locationId: int
    locationName: str


@dataclass
class AbstractProcessingStep:
    type: Literal["processing"]
    actionId: int
    actionName: str


@dataclass
class AbstractMoveToStep:
    type: Literal["move_to"]
    motionType: str  # "LINEAR" | "JOINT"
    locationId: int
    locationName: str


@dataclass
class AbstractGripperStep:
    type: Literal["gripper"]
    state: str  # "OPEN" | "CLOSE"


@dataclass
class AbstractWaitStep:
    type: Literal["wait"]
    seconds: int


@dataclass
class AbstractHumanActionStep:
    type: Literal["human_action"]
    description: str
    confirmEvent: Optional[AbstractCondition] = None


@dataclass
class AbstractNotifyActionStep:
    type: Literal["notify_action"]
    description: str

@dataclass
class AbstractRepeatStep:
    type: Literal["repeat"]
    times: int
    steps: List["AbstractStep"]

@dataclass
class AbstractRepeatUntilStep:
    type: Literal["repeat_until"]
    condition: AbstractCondition
    do: List["AbstractStep"]

@dataclass
class AbstractWhenStep:
    type: Literal["when"]
    condition: Optional[AbstractCondition]
    do: List["AbstractStep"]
    otherwise: Optional[List["AbstractStep"]] = None

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
- {{"type": "gesture", "gestureType": "THUMBS_UP" | "OPEN_HAND"}}
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
   - "Gesture detected" (gesture_block): Detects human gestures (e.g., THUMBS_UP, OPEN_HAND, STOP).
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

CONDITION_SCHEMA = {
    "type": "object",
    "properties": {
        "type": {
            "type": "string",
            "enum": [
                "sensor_signal",
                "find_object",
                "human_feedback",
                "touch_detect",
                "gesture",
                "timer",
            ]
        },
        "sensor": {"type": "string"},
        "objectId": {"type": "integer"},
        "objectName": {"type": "string"},
        "gestureType": {"type": "string"},
        "seconds": {"type": "integer"}
    },
    "required": ["type"]
}

SIMPLE_STEP_SCHEMA = {
    "type": "object",
    "properties": {
        "type": {
            "type": "string",
            "enum": [
                "pick",
                "place",
                "processing",
                "move_to",
                "gripper",
                "wait",
                "human_action",
                "notify_action"
            ],
            "description": "Step type"
        },
        "seconds": {"type": "integer", "description": "Duration in seconds for wait step"},
        "objectId": {"type": "integer"},
        "objectName": {"type": "string"},
        "locationId": {"type": "integer"},
        "locationName": {"type": "string"},
        "actionId": {"type": "integer"},
        "actionName": {"type": "string"},
        "motionType": {"type": "string", "enum": ["LINEAR", "JOINT"]},
        "state": {"type": "string", "enum": ["OPEN", "CLOSE"]},
        "description": {"type": "string", "description": "Message for human interaction"},
        "confirmEvent": {
            **CONDITION_SCHEMA,
            "description": "Event required to resume from human action"
        }
    },
    "required": ["type"]
}

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
            subsequent_siblings = steps[i+1:]
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
                    answer = "Ok! Andiamo avanti."
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
                            if not steps: # fallback if steps is None or empty list []
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
                            if not steps: # fallback if do is None or empty list []
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
                            if gesture_type not in ["THUMBS_UP", "OPEN_HAND", "STOP"]:
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
                    print("Inner chat parse error:", inner_e)
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
        print("Exception in new_message_multimodal:", e)
        import traceback
        traceback.print_exc()
        return error_response(f"Server error: {str(e)}")
