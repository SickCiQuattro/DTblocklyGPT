#!/usr/bin/env python3
"""
Multi-LLM evaluation harness for the chat pipeline (backend/functions/chat.py).

Runs a golden set of cases (testing/eval_llm_cases.jsonl) against one or more
LLM providers/models and reports intent/task/validation accuracy + latency,
so you can A/B a model swap (e.g. gemini-2.5-flash vs a local Ollama model)
before flipping LLM_PROVIDER in production.

Run with:
    poetry run python testing/eval_llm_chat.py --models gemini:gemini-3.1-flash-lite ollama:llama3.1:8b

Default matrix (no --models): gemini from env if GEMINI_API_KEY/LLM_API_KEY is
set, plus ollama:qwen3.5:9b if http://localhost:11434 answers. Either is
skipped with a note if unavailable.

Repeat each case N times with --runs (default 5) to get mean/stdev per metric
and flag flaky cases (pass/fail changed across runs). Use --rpm to throttle
requests (needed for free-tier quotas like Gemini) and --json to dump raw
per-case, per-run results for testing/eval_llm_report.py.
"""
import argparse
import json
import os
import statistics
import sys
import time
import urllib.request
from datetime import date
from types import SimpleNamespace
from typing import Union

import requests

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "django_project_conf.settings")
import django  # noqa: E402
django.setup()

from openai import RateLimitError  # noqa: E402


class DailyQuotaExhausted(Exception):
    """Raised instead of retrying when a 429 is a per-day quota (resets in
    ~24h, not something a 2-16s backoff will ever recover from) rather than
    a per-minute rate limit. Gemini's free tier reports this via
    quotaId=...PerDay...-FreeTier / status=RESOURCE_EXHAUSTED in the error
    body. A plain HTTP 429 doesn't distinguish the two on its own."""


from backend.functions.chat import (  # noqa: E402
    CHATGPT_FUNCTION_MULTIMODAL,
    CHATGPT_INSTRUCTIONS_MULTIMODAL,
    CHATGPT_TEMPERATURE,
    LLM_API_KEY,
    GEMINI_API_KEY,
    OPENAI_API_KEY,
    OLLAMA_BASE_URL,
    LLMProvider,
    ProviderLLMResponse,
    format_blocks_catalog,
    repair_flattened_steps,
    validate_step,
)

CASES_PATH = os.path.join(os.path.dirname(__file__), "eval_llm_cases.jsonl")
RPD_STATE_PATH = os.path.join(os.path.dirname(__file__), ".eval_rpd_state.json")

DATA_OBJECTS = [
    {"id": 1, "name": "widget", "keywords": None},
    {"id": 2, "name": "red pill", "keywords": None},
    {"id": 3, "name": "flask", "keywords": None},
    {"id": 4, "name": "box", "keywords": None},
    {"id": 5, "name": "blue flask", "keywords": ["provetta blu", "blue tube"]},
]
DATA_LOCATIONS = [
    {"id": 1, "name": "bin A", "keywords": None},
    {"id": 2, "name": "inspection zone", "keywords": None},
    {"id": 3, "name": "box", "keywords": None},
    {"id": 4, "name": "table", "keywords": None},
]
DATA_ACTIONS = [
    {"id": 1, "name": "scan", "keywords": None},
]
DATA_BLOCKS = [
    {"category": "Task Flow", "blocks": [
        {"label": "Repeat times", "description": "Repeats its steps a fixed number of times."},
        {"label": "Repeat until", "description": "Repeats its steps until a condition becomes true."},
        {"label": "When → Do", "description": "Runs its steps once a condition becomes true."},
        {"label": "When → Do / Otherwise", "description": "Runs one branch or the other depending on a condition."},
    ]},
    {"category": "Robot Actions", "blocks": [
        {"label": "Pick up", "description": "Tells the robot to grab the chosen object."},
        {"label": "Place at", "description": "Tells the robot to set the object down at the chosen location."},
        {"label": "Move to", "description": "Moves the robot to a location without picking or placing."},
        {"label": "Execute skill", "description": "Runs a custom robot skill."},
        {"label": "Open Gripper", "description": "Opens the robot gripper."},
        {"label": "Close Gripper", "description": "Closes the robot gripper."},
        {"label": "Wait", "description": "Pauses the robot for a number of seconds."},
    ]},
    {"category": "Human Actions", "blocks": [
        {"label": "Pause and show message", "description": "Pauses the robot and waits for the operator to confirm."},
        {"label": "Show message", "description": "Sends a message to the operator without pausing the robot."},
    ]},
    {"category": "Conditions", "blocks": [
        {"label": "Object detected", "description": "True while the camera sees the chosen object."},
        {"label": "Gesture detected", "description": "True when the camera sees the chosen hand gesture."},
        {"label": "Time passed", "description": "True once a number of seconds has elapsed."},
    ]},
    {"category": "Twin Library", "blocks": [{"label": "Twin Library", "dynamic": True}]},
    {"category": "Saved Tasks", "blocks": [{"label": "Saved Tasks", "dynamic": True}]},
]

PROVIDER_DEFAULTS = {
    "gemini": "gemini-3.1-flash-lite",
    "openai": "gpt-4.1-nano",
    "ollama": "qwen3.5:9b",
    "ollama-nothink": "qwen3.5:9b",
}

# $ per million tokens (input, output). Ollama and Gemini's free tier are $0.
# Only populate providers/models that are actually billed, so cost reporting
# can tell "priced at $0" apart from "no pricing data available".
#
# gpt-5.x (nano/mini/etc.) is a reasoning-style family: it rejects a
# non-default temperature (see LLMProvider.complete's gpt-5 special case) and
# spends hidden reasoning tokens even on trivial prompts. One measured call
# used 1575 completion tokens and 13.7s latency for a single pick+place,
# vs. 86 tokens / 1.6s on gpt-4.1-nano for the same prompt. Kept here for
# reference/comparison, but gpt-4.1-* is the default: no reasoning overhead,
# ordinary temperature support, response times usable for interactive HRI.
COST_PER_MTOK = {
    "gpt-4.1-nano": {"input": 0.10, "output": 0.40},
    "gpt-4.1-mini": {"input": 0.40, "output": 1.60},
    "gpt-5-nano": {"input": 0.05, "output": 0.40},
    "gpt-5-mini": {"input": 0.25, "output": 2.00},
    # legacy reference, kept for comparison if someone benchmarks the old default
    "gpt-4o-mini": {"input": 0.15, "output": 0.60},
}


def build_system_prompt(scene="unavailable"):
    prompt = CHATGPT_INSTRUCTIONS_MULTIMODAL
    prompt = prompt.replace("{{objects}}", json.dumps(DATA_OBJECTS, ensure_ascii=False))
    prompt = prompt.replace("{{locations}}", json.dumps(DATA_LOCATIONS, ensure_ascii=False))
    prompt = prompt.replace("{{actions}}", json.dumps(DATA_ACTIONS, ensure_ascii=False))
    prompt = prompt.replace("{{blocks}}", format_blocks_catalog(DATA_BLOCKS))
    prompt = prompt.replace("{{scene}}", json.dumps(scene, ensure_ascii=False))
    return prompt


class OllamaNativeProvider:
    """Talks to Ollama's native /api/chat instead of the OpenAI-compatible
    /v1/chat/completions that LLMProvider uses. Exists solely to make
    Ollama-only request options (here: think=False) actually take effect —
    both `extra_body={"options": {"num_ctx": N}}` and `extra_body={"think":
    False}` are silently ignored on the OpenAI-compat endpoint (verified,
    see EVAL_LLM.md bug #3/#4); only /api/chat honors them. Mirrors
    LLMProvider's .complete() signature/return type so run_case() doesn't
    need to know which one it's holding."""

    def __init__(self, model: str, base_url: str, timeout: int = 120, think: bool = False):
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.think = think

    def complete(self, messages, tools, tool_name, temperature: float = 0.0) -> ProviderLLMResponse:
        payload = {
            "model": self.model,
            "messages": messages,
            "tools": tools,
            "stream": False,
            "think": self.think,
            "options": {"temperature": temperature},
        }
        response = requests.post(f"{self.base_url}/api/chat", json=payload, timeout=self.timeout)
        response.raise_for_status()
        data = response.json()
        msg = data.get("message", {})

        tool_calls = msg.get("tool_calls") or []
        if tool_calls:
            arguments = tool_calls[0]["function"]["arguments"]
            raw_arguments = arguments if isinstance(arguments, dict) else json.loads(arguments or "{}")
        else:
            try:
                raw_arguments = json.loads(msg.get("content") or "{}")
            except Exception:
                raw_arguments = {}

        usage = SimpleNamespace(prompt_tokens=data.get("prompt_eval_count"), completion_tokens=data.get("eval_count"))
        return ProviderLLMResponse(answer=raw_arguments.get("answer", ""), raw_arguments=raw_arguments, raw_response=SimpleNamespace(usage=usage))


# Either provider works with call_with_throttle_and_retry/run_case: same
# .complete(messages, tools, tool_name, temperature) -> ProviderLLMResponse shape.
Provider = Union[LLMProvider, OllamaNativeProvider]


def build_provider(spec: str) -> Provider:
    if ":" in spec:
        provider_name, model = spec.split(":", 1)
    else:
        provider_name, model = spec, PROVIDER_DEFAULTS.get(spec)

    if provider_name == "ollama-nothink":
        if not model:
            raise ValueError(f"No model for provider '{provider_name}' (spec was '{spec}').")
        # Bypasses the api_key/OpenAI-client path entirely — native Ollama
        # needs no auth and this class isn't an LLMProvider.
        return OllamaNativeProvider(model=model, base_url=OLLAMA_BASE_URL.replace("/v1", ""), timeout=120, think=False)

    if provider_name == "gemini":
        api_key = LLM_API_KEY or GEMINI_API_KEY
        base_url = "https://generativelanguage.googleapis.com/v1beta/openai/"
    elif provider_name == "openai":
        api_key = LLM_API_KEY or OPENAI_API_KEY
        base_url = None
    elif provider_name == "ollama":
        api_key = LLM_API_KEY or "ollama"
        base_url = OLLAMA_BASE_URL
    elif provider_name == "anthropic":
        # Predisposed, not wired up: Anthropic's Messages API isn't
        # OpenAI-compatible (different tool-call schema, no /chat/completions
        # endpoint), so this can't reuse LLMProvider's OpenAI client as-is.
        # Activate by adding a dedicated provider class that translates
        # CHATGPT_FUNCTION_MULTIMODAL to an Anthropic tool definition and
        # maps the response back to ProviderLLMResponse.
        raise NotImplementedError(
            "anthropic provider is scaffolded but not implemented; it needs "
            "a non-OpenAI-compatible client (see plan Fase 1.6)."
        )
    else:
        raise ValueError(f"Unknown provider '{provider_name}' (use gemini, openai, ollama).")

    if not api_key:
        raise ValueError(f"No API key for provider '{provider_name}'.")

    # Ollama on modest local hardware routinely exceeds the 30s that's plenty
    # for cloud providers (granite4.1:8b/qwen3.5:9b measured 33-41s on a
    # single well-formed reply) — a short timeout there just turns a slow-but-
    # correct answer into a spurious ERROR after burning 3x the timeout on
    # retries that fail identically.
    timeout = 120 if provider_name == "ollama" else 30
    return LLMProvider(api_key=api_key, base_url=base_url, model=model, timeout=timeout, max_retries=2)


def ollama_available() -> bool:
    try:
        urllib.request.urlopen(OLLAMA_BASE_URL.replace("/v1", ""), timeout=1.5)
        return True
    except Exception:
        return False


def default_model_specs():
    specs = []
    if LLM_API_KEY or GEMINI_API_KEY:
        specs.append(f"gemini:{PROVIDER_DEFAULTS['gemini']}")
    else:
        print("skip gemini: no GEMINI_API_KEY/LLM_API_KEY set")
    if ollama_available():
        specs.append(f"ollama:{PROVIDER_DEFAULTS['ollama']}")
    else:
        print(f"skip ollama: {OLLAMA_BASE_URL} not reachable")
    return specs


def load_cases():
    cases = []
    with open(CASES_PATH) as f:
        for line in f:
            line = line.strip()
            if line:
                cases.append(json.loads(line))
    return cases


def top_level_types(task):
    return [step.get("type") for step in task] if isinstance(task, list) else []


def _load_rpd_state():
    try:
        with open(RPD_STATE_PATH) as f:
            return json.load(f)
    except Exception:
        return {}


def _bump_rpd(spec: str) -> int:
    """Persist a per-day, per-model-spec request counter so a Gemini free-tier
    RPD limit (e.g. Gemini 2.5 Flash: 20/day) can be watched across separate
    script invocations in the same day, not just within one run."""
    state = _load_rpd_state()
    today = date.today().isoformat()
    day_bucket = state.setdefault(today, {})
    day_bucket[spec] = day_bucket.get(spec, 0) + 1
    # drop older days so the file doesn't grow forever
    for key in list(state.keys()):
        if key != today:
            del state[key]
    with open(RPD_STATE_PATH, "w") as f:
        json.dump(state, f)
    return day_bucket[spec]


def _estimate_cost_usd(model: str, prompt_tokens, completion_tokens):
    pricing = COST_PER_MTOK.get(model)
    if pricing is None or prompt_tokens is None or completion_tokens is None:
        return None
    return (prompt_tokens * pricing["input"] + completion_tokens * pricing["output"]) / 1_000_000


def _throttle(rpm: int, last_call_at: list):
    """Sleep to respect --rpm. Kept separate from the timed call so the
    enforced inter-request gap never leaks into the measured latency.
    At rpm=15 that gap is 4s, which would otherwise swamp the true
    network/inference time in the latency stats."""
    if rpm > 0 and last_call_at[0] is not None:
        min_interval = 60.0 / rpm
        elapsed = time.monotonic() - last_call_at[0]
        if elapsed < min_interval:
            time.sleep(min_interval - elapsed)
    last_call_at[0] = time.monotonic()


def call_with_throttle_and_retry(provider: Provider, messages, rpm: int, last_call_at: list):
    """Throttle for --rpm, then call the provider, retrying on 429 with
    backoff honoring Retry-After when the server sends one (free-tier quotas
    like Gemini's return 429 fast and reliably once RPM is exceeded). Returns
    (response, latency_ms), where latency_ms times only the successful call:
    throttle sleep and any failed-attempt backoff are excluded."""
    _throttle(rpm, last_call_at)

    max_attempts = 5
    backoff = 2.0
    for attempt in range(1, max_attempts + 1):
        try:
            call_started_at = time.monotonic()
            response = provider.complete(
                messages=messages,
                tools=[CHATGPT_FUNCTION_MULTIMODAL],
                tool_name=CHATGPT_FUNCTION_MULTIMODAL["function"]["name"],
                temperature=CHATGPT_TEMPERATURE,
            )
            return response, (time.monotonic() - call_started_at) * 1000
        except RateLimitError as e:
            if "PerDay" in str(e):
                raise DailyQuotaExhausted(str(e)) from e
            if attempt == max_attempts:
                raise
            retry_after = None
            response = getattr(e, "response", None)
            if response is not None:
                retry_after = response.headers.get("retry-after")
            wait_s = float(retry_after) if retry_after else backoff
            print(f"    429 rate limited, retry {attempt}/{max_attempts} after {wait_s:.0f}s", file=sys.stderr)
            time.sleep(wait_s)
            backoff *= 2
    raise RuntimeError("unreachable: retry loop exited without returning or raising")


def run_case(provider: Provider, case: dict, model_spec: str, rpm: int, last_call_at: list) -> dict:
    system_prompt = build_system_prompt(case.get("scene", "unavailable")) + f"\n\n# CURRENT TASK SNAPSHOT #\n{json.dumps(case['snapshot'], ensure_ascii=False)}"
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": case["message"]},
    ]

    started_at = time.monotonic()
    try:
        response, latency_ms = call_with_throttle_and_retry(provider, messages, rpm, last_call_at)
        _bump_rpd(model_spec)
    except DailyQuotaExhausted:
        raise
    except Exception as e:
        return {
            "name": case["name"], "category": case.get("category"), "lang": case.get("lang"),
            "error": str(e), "pass": False, "latency_ms": (time.monotonic() - started_at) * 1000,
        }

    raw = response.raw_arguments
    task_raw = raw.get("task", "[]")
    try:
        task = json.loads(task_raw) if isinstance(task_raw, str) else (task_raw or [])
    except Exception:
        task = []

    warnings = []
    if isinstance(task, list) and task:
        task = repair_flattened_steps(task, warnings)
    validated = [validate_step(s, i, warnings, DATA_OBJECTS, DATA_LOCATIONS, DATA_ACTIONS) for i, s in enumerate(task)]
    validated = [v for v in validated if v is not None]  # drop steps validate_step rejected (e.g. non-dict), matching sequenceToSteps' "keep only truthy steps" (CLAUDE.md)

    expect = case["expect"]
    intent_ok = raw.get("intent") == expect["intent"]
    task_modified_ok = bool(raw.get("taskModified")) == expect["taskModified"]
    types_ok = top_level_types(validated) == expect["task_types"]
    no_errors = not any(w["severity"] == "error" for w in warnings)
    lang_ok = True
    if "lang_prefix" in expect:
        lang_ok = str(raw.get("lang", "")).lower().startswith(expect["lang_prefix"])

    overall = intent_ok and task_modified_ok and types_ok and no_errors and lang_ok

    usage = getattr(response.raw_response, "usage", None)
    prompt_tokens = getattr(usage, "prompt_tokens", None)
    completion_tokens = getattr(usage, "completion_tokens", None)

    return {
        "name": case["name"],
        "category": case.get("category"),
        "lang": case.get("lang"),
        "pass": overall,
        "intent_ok": intent_ok,
        "task_modified_ok": task_modified_ok,
        "types_ok": types_ok,
        "no_errors": no_errors,
        "lang_ok": lang_ok,
        "latency_ms": latency_ms,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "cost_usd": _estimate_cost_usd(provider.model, prompt_tokens, completion_tokens),
        "got_intent": raw.get("intent"),
        "got_task_modified": raw.get("taskModified"),
        "got_types": top_level_types(validated),
        "warnings": [w["message"] for w in warnings if w["severity"] == "error"],
    }


def print_report(model_spec: str, results: list, runs: int):
    total = len(results)
    passed = sum(1 for r in results if r["pass"])
    intent_acc = sum(1 for r in results if r.get("intent_ok")) / total * 100
    task_acc = sum(1 for r in results if r.get("types_ok")) / total * 100
    latencies = [r["latency_ms"] for r in results]
    avg_latency = statistics.mean(latencies)
    total_cost = sum(r["cost_usd"] for r in results if r.get("cost_usd") is not None)
    priced_count = sum(1 for r in results if r.get("cost_usd") is not None)

    cases_per_run = len(set(r["name"] for r in results)) or 1
    runs_completed = total / cases_per_run
    runs_label = f"{runs_completed:g}" if runs_completed != runs else str(runs)
    print(f"\n## {model_spec}  ({runs_label}/{runs} run{'s' if runs != 1 else ''} x {cases_per_run} cases = {total} calls)")
    print(f"pass rate: {passed}/{total} ({passed / total * 100:.0f}%) | intent acc: {intent_acc:.0f}% | task acc: {task_acc:.0f}% | avg latency: {avg_latency:.0f}ms")
    if len(latencies) > 1:
        print(f"latency stdev: {statistics.stdev(latencies):.0f}ms")
    if priced_count:
        print(f"est. cost: ${total_cost:.4f} over {priced_count} priced calls (${total_cost / priced_count * 1000:.2f} / 1000 calls)")

    # per-category breakdown
    by_category = {}
    for r in results:
        by_category.setdefault(r.get("category") or "uncategorized", []).append(r)
    if len(by_category) > 1:
        print("\nby category:")
        for cat, rs in sorted(by_category.items()):
            cat_pass = sum(1 for r in rs if r["pass"])
            print(f"  - {cat}: {cat_pass}/{len(rs)} ({cat_pass / len(rs) * 100:.0f}%)")

    # flaky detection: same case name, different pass/fail across runs
    by_name = {}
    for r in results:
        by_name.setdefault(r["name"], []).append(r["pass"])
    flaky = [name for name, passes in by_name.items() if len(set(passes)) > 1]
    if flaky:
        print(f"\nflaky cases (inconsistent pass/fail across {runs} runs): {', '.join(sorted(flaky))}")

    failures = [r for r in results if not r["pass"]]
    if failures:
        print("\nfailures:")
        seen_names = set()
        for r in failures:
            if r["name"] in seen_names:
                continue
            seen_names.add(r["name"])
            if "error" in r:
                print(f"  - {r['name']}: ERROR {r['error']}")
                continue
            reasons = []
            if not r["intent_ok"]:
                reasons.append(f"intent={r['got_intent']}")
            if not r["task_modified_ok"]:
                reasons.append(f"taskModified={r['got_task_modified']}")
            if not r["types_ok"]:
                reasons.append(f"types={r['got_types']}")
            if not r["no_errors"]:
                reasons.append(f"warnings={r['warnings']}")
            if not r["lang_ok"]:
                reasons.append("lang mismatch")
            print(f"  - {r['name']}: {', '.join(reasons)}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--models", nargs="+", help="provider:model specs, e.g. gemini:gemini-3.1-flash-lite ollama:llama3.1:8b")
    parser.add_argument("--runs", type=int, default=5, help="repeat the full case set N times per model (default 5)")
    parser.add_argument("--rpm", type=int, default=0, help="throttle requests to N per minute per model (0 = no throttling; use ~15 for Gemini free tier)")
    parser.add_argument("--json", dest="json_path", help="write raw per-case, per-run results to this file")
    parser.add_argument("--start-at", type=int, default=0, help="skip the first N cases, for resuming coverage on a low-RPD model across multiple days instead of re-covering the same leading cases every reset")
    args = parser.parse_args()

    model_specs = args.models or default_model_specs()
    if not model_specs:
        print("No models available to evaluate (no API key, no local Ollama). Aborting.")
        return 1

    cases = load_cases()
    if args.start_at:
        skipped = cases[:args.start_at]
        cases = cases[args.start_at:]
        print(f"skipping first {len(skipped)} cases (--start-at {args.start_at}), {len(cases)} remain", file=sys.stderr)
    all_results = {}
    for spec in model_specs:
        try:
            provider = build_provider(spec)
        except (ValueError, NotImplementedError) as e:
            print(f"skip {spec}: {e}")
            continue
        results = []
        last_call_at = [None]
        try:
            for run_idx in range(args.runs):
                if args.runs > 1:
                    print(f"  {spec}: run {run_idx + 1}/{args.runs}...", file=sys.stderr)
                for case in cases:
                    results.append(run_case(provider, case, spec, args.rpm, last_call_at))
        except DailyQuotaExhausted as e:
            print(f"  {spec}: daily quota exhausted after {len(results)} calls, stopping this model: {e}", file=sys.stderr)
        if results:
            print_report(spec, results, args.runs)
            all_results[spec] = results

    if args.json_path:
        os.makedirs(os.path.dirname(args.json_path) or ".", exist_ok=True)
        with open(args.json_path, "w") as f:
            json.dump(all_results, f, indent=2, ensure_ascii=False)
        print(f"\nraw results written to {args.json_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
