"""Print a randomised trial order and a blank score sheet, for counting by hand.

    poetry run python testing/recognition_plan.py --channel gesture --operator op1
    poetry run python testing/recognition_plan.py --channel voice --trials 30

Needs nothing: no camera, no microphone, no mediapipe, no Django. It runs on
the dev VM, which is the point — the observer prepares the sheet here and does
the session wherever the hardware is.

Counting by hand is a legitimate instrument and in one respect a better one
than the automated benches: watching the app's own "Test recognition" panel
measures the whole delivered chain — the HTTP round-trip, the browser's capture
cadence, and what actually renders — while a bench stops at the recognizer. It
buys that at the cost of onset latency, which no observer can time by eye, and
of the brief mis-recognitions that flicker past between frames.

What makes a hand count citable is not the counting, it is that the trial order
and the scoring rule were fixed BEFORE the session. That is what this file is:
the order is generated from a recorded seed, and the sheet has one row per
trial with `observed` left blank. Deciding what counts as a success after
seeing the results is the failure mode this exists to prevent.

Fill the `observed` column with what the panel showed — the exact class name,
or NONE if nothing appeared — then:

    poetry run python testing/recognition_report.py testing/out/manual_*.csv

which puts hand-counted trials through the same Wilson intervals, the same
false-positive accounting, and the same pooled figure as the automated runs.
"""

import os
import csv
import time
import random
import argparse

# Kept in step with the two benches by hand, same caveat the benches carry
# about frontend/src/constants/recognitionRegistry.ts. A class here that the
# app does not expose would produce a row nobody can score.
CLASSES = {
    "gesture": (
        ["THUMBS_UP", "THUMBS_DOWN", "OPEN_HAND", "FIST", "PEACE", "OK"],
        "REST",
        "Hands still and relaxed",
    ),
    "voice": (
        ["YES", "NO", "DONE", "PROCEED"],
        "SILENCE",
        "Say nothing",
    ),
}

# What the operator is asked to produce. The voice prompts are the Italian
# spoken forms, matching SPEECH_LANG's default and what the app's wait message
# tells a participant to say — an observer reading "DONE" aloud to an it-IT
# recognizer would be scoring the wrong thing.
PROMPTS = {
    "THUMBS_UP": "Thumbs up", "THUMBS_DOWN": "Thumbs down",
    "OPEN_HAND": "Open hand", "FIST": "Fist",
    "PEACE": "Peace sign", "OK": "OK sign",
    "YES": 'say "sì"', "NO": 'say "no"',
    "DONE": 'say "fatto"', "PROCEED": 'say "procedi"',
}


def build_plan(channel: str, trials: int, seed: int) -> list:
    classes, silence, _ = CLASSES[channel]
    plan = [c for c in classes for _ in range(trials)] + [silence] * trials
    random.Random(seed).shuffle(plan)
    return plan


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--channel", choices=sorted(CLASSES), required=True)
    parser.add_argument("--operator", default="", help="Who performs the trials")
    parser.add_argument("--trials", type=int, default=10,
                        help="Trials per class (30 supports 'error below 10%%'; default 10)")
    parser.add_argument("--seed", type=int, default=None,
                        help="Order seed; omit for a random one (it is written into the sheet)")
    args = parser.parse_args()

    seed = args.seed if args.seed is not None else random.randrange(1_000_000_000)
    plan = build_plan(args.channel, args.trials, seed)
    _, silence, silence_prompt = CLASSES[args.channel]

    out_dir = os.path.join(os.path.dirname(__file__), "out")
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(
        out_dir,
        f"manual_{args.channel}_{args.operator or 'anon'}_{int(time.time())}.csv",
    )
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["channel", "operator", "seed", "trial", "expected",
                         "prompt", "observed", "notes"])
        for i, expected in enumerate(plan, 1):
            prompt = silence_prompt if expected == silence else PROMPTS.get(expected, expected)
            writer.writerow([args.channel, args.operator, seed, i, expected, prompt, "", ""])

    print(f"\n{len(plan)} trials, {args.trials} per class, seed {seed}")
    print(f"Sheet: {path}\n")
    print("Fill the `observed` column with what the panel showed — the exact class")
    print(f"name, or NONE if nothing appeared. A {silence} trial scores NONE when the")
    print("panel stayed quiet; anything else on those rows is a false positive, which")
    print("is the number that decides whether the channel is safe to leave armed.\n")
    for i, expected in enumerate(plan, 1):
        prompt = silence_prompt if expected == silence else PROMPTS.get(expected, expected)
        print(f"  {i:>4}. {prompt}")
    print("\nThen: poetry run python testing/recognition_report.py " + path)


if __name__ == "__main__":
    main()
