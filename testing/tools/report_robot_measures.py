#!/usr/bin/env python3
"""Summarise a robot-measurement session from the STUDY_LOG_PATH file.

Run the stack with STUDY_LOG_PATH pointing at a file of its own (never a
participant's), do the measurements, then:

    poetry run python testing/tools/report_robot_measures.py misure-robot.jsonl
    poetry run python testing/tools/report_robot_measures.py misure-robot.jsonl --vuote 3,7,9

It reads four kinds of line the backend writes:

  step        one per executed block, with target sim|real   -> twin-vs-real sequences
  hw_arrival  encoder gap after every real-arm move           -> margin behind the 2 deg threshold
  hw_grasp    gripper width after every pick's close          -> margin behind the 1.5 mm threshold
  run_start / run_end                                         -> cycles, durations, outcomes

Nothing here decides anything: the tables are what goes in the chapter, and the
things the log cannot know (a tube that fell, a cap that was misread) are listed
as "da classificare a mano" instead of being guessed.

--vuote takes the 1-based positions, among the hw_grasp lines, of the grasps you
did with NOTHING between the fingers. The log cannot know that, and the whole
point of the width check is whether those separate from the ones that held.
"""
import argparse
import json
import statistics as st
import sys
from collections import Counter, defaultdict

SOGLIA_MM_DEFAULT = 1.5


def carica(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(x) for x in f if x.strip()]


def classifica(motivo):
    """Failure type from the abort text. Only what the log can really tell."""
    m = (motivo or "").lower()
    if not m:
        return "nessun motivo registrato"
    if "closed on empty air" in m or "wasn't picked up" in m:
        return "presa a vuoto rilevata"
    if "didn't reach the position" in m or "rejected the last move" in m or "lost connection" in m:
        return "errore di movimento"
    if "camera" in m or "watching for objects" in m or "vision" in m:
        return "errore di percezione"
    return "da classificare a mano"


def cicli(ev):
    runs, aperto = [], None
    for e in ev:
        if e["kind"] == "run_start":
            # Keyed by id as well as name: two different tasks can carry the same
            # name ("New Task" is what the editor calls every unsaved task), and
            # grouping by name alone compared a task with a different one.
            nome = e.get("task_name")
            aperto = {"task": nome if e.get("task_id") is None else f"{nome} #{e['task_id']}",
                      "target": e.get("target"), "t0": e["t_mono"],
                      "passi": [], "auto": bool(e.get("simulate_event"))}
        elif e["kind"] == "step" and aperto is not None:
            aperto["passi"].append((e["block"], e.get("depth", 0)))
        elif e["kind"] == "run_end" and aperto is not None:
            aperto.update(esito=e.get("outcome"), motivo=e.get("abort_reason"),
                          durata=round(e["t_mono"] - aperto["t0"], 1))
            runs.append(aperto)
            aperto = None
    return runs


def q(v, p):
    v = sorted(v)
    return v[min(len(v) - 1, int(round(p * (len(v) - 1))))]


def sez_cicli(runs):
    print("## Esecuzioni\n")
    if not runs:
        print("Nessuna esecuzione registrata.\n")
        return
    print(f"{len(runs)} esecuzioni: " + ", ".join(f"{k} {n}" for k, n in
          Counter(f"{r['target']}/{r['esito']}" for r in runs).most_common()) + "\n")
    falliti = [r for r in runs if r["esito"] not in ("completed",)]
    if falliti:
        print("Non completate, per tipo:")
        for k, n in Counter(classifica(r["motivo"]) for r in falliti).most_common():
            print(f"- {k}: {n}")
        print()
    real = [r["durata"] for r in runs if r["target"] == "real" and r["esito"] == "completed"]
    if real:
        print(f"Durata sul robot, completate: mediana {st.median(real):.1f} s, "
              f"intervallo {min(real):.1f}–{max(real):.1f} s (n={len(real)})\n")


def sez_corrispondenza(runs):
    print("## Corrispondenza gemello–robot\n")
    per = defaultdict(lambda: {"sim": [], "real": []})
    for r in runs:
        if r["target"] in ("sim", "real"):
            per[r["task"]][r["target"]].append(r)
    if not per:
        print("Nessuna esecuzione con passi registrati.\n")
        return
    print("| compito | sim | robot | stessi passi, stesso ordine | stesso esito | dove divergono |")
    print("| --- | --- | --- | --- | --- | --- |")
    for task, d in sorted(per.items(), key=lambda x: str(x[0])):
        if not d["sim"] or not d["real"]:
            print(f"| {task} | {len(d['sim'])} | {len(d['real'])} | — | — | manca un lato |")
            continue
        # The last COMPLETED run per side when there is one: the last run of a
        # task is often a deliberate abort (an empty grasp, a Stop), and comparing
        # that with a clean run reports a divergence that is the test, not the twin.

        def scelta(lista):
            complete = [x for x in lista if x["esito"] == "completed"]
            return (complete or lista)[-1]
        s, r = scelta(d["sim"]), scelta(d["real"])
        uguali = s["passi"] == r["passi"]
        dove = "—"
        if not uguali:
            i = next((k for k, (a, b) in enumerate(zip(s["passi"], r["passi"])) if a != b),
                     min(len(s["passi"]), len(r["passi"])))
            dove = (f"passo {i + 1}: sim {s['passi'][i][0] if i < len(s['passi']) else 'fine'}, "
                    f"robot {r['passi'][i][0] if i < len(r['passi']) else 'fine'}")
        print(f"| {task} | {len(d['sim'])} | {len(d['real'])} | {'sì' if uguali else 'NO'} "
              f"({len(s['passi'])}/{len(r['passi'])}) | {'sì' if s['esito'] == r['esito'] else 'NO'} "
              f"({s['esito']}/{r['esito']}) | {dove} |")
    print("\nSi confronta l'ultima esecuzione COMPLETATA per lato (l'ultima, se nessuna lo e'). Le ripetizioni sono nel registro.\n")


def sez_arrivi(ev):
    print("## Arrivi del braccio reale: scarto degli encoder\n")
    a = [e for e in ev if e["kind"] == "hw_arrival" and e.get("max_delta_deg") is not None]
    if not a:
        print("Nessun arrivo registrato (servono esecuzioni sul robot con STUDY_LOG_PATH attivo).\n")
        return
    tol = a[0]["tol_deg"]
    v = [e["max_delta_deg"] for e in a]
    print(f"{len(a)} arrivi, soglia {tol:g}°. Scarto massimo fra i giunti, per arrivo: "
          f"mediana {st.median(v):.3f}°, 95° percentile {q(v, .95):.3f}°, massimo {max(v):.3f}°.")
    print(f"Sopra 1°: {sum(x > 1 for x in v)}; sopra la soglia: {sum(x > tol for x in v)}; "
          f"arresti per divergenza: {sum(1 for e in a if not e['ok'])}. "
          f"Il massimo occupa il {100 * max(v) / tol:.0f}% della soglia.\n")
    per = defaultdict(list)
    for e in a:
        per[e.get("step") or "?"].append(e["max_delta_deg"])
    print("| passo | n | mediana | massimo |\n| --- | --- | --- | --- |")
    for k, x in sorted(per.items()):
        print(f"| {k} | {len(x)} | {st.median(x):.3f} | {max(x):.3f} |")
    print()


def sez_prese(ev, vuote):
    print("## Larghezza della pinza dopo la chiusura\n")
    g = [e for e in ev if e["kind"] == "hw_grasp" and e.get("hand_mm") is not None
         and not e.get("stopping") and e["hand_mm"] < 25]
    scartate = sum(1 for e in ev if e["kind"] == "hw_grasp" and e.get("hand_mm") is not None) - len(g)
    if scartate:
        print(f"({scartate} righe scartate: Stop gia' scattato o pinza aperta al momento della lettura — non sono prese.)\n")
    if not g:
        print("Nessuna presa registrata.\n")
        return
    # The threshold in force at the LAST grasp: it changed during a session
    # (1.5 -> 0.07 mm on 2026-09-29), and the first row is the stale one.
    tols = sorted({e.get("tol_mm") for e in g if e.get("tol_mm")})
    tol = g[-1]["tol_mm"] if g[-1].get("tol_mm") else SOGLIA_MM_DEFAULT
    if len(tols) > 1:
        print(f"(soglie diverse nel registro: {tols}; sotto vale l'ultima, {tol:g} mm)\n")
    vuoto = [e for i, e in enumerate(g, 1) if i in vuote]
    tenuto = [e for i, e in enumerate(g, 1) if i not in vuote]
    print(f"{len(g)} prese; soglia {tol:g} mm sopra la larghezza comandata. "
          f"Margine = larghezza letta − comandata.\n")
    print("| # | ora | letta (mm) | comandata (mm) | margine (mm) | decisione del sistema | segnata a vuoto |")
    print("| --- | --- | --- | --- | --- | --- | --- |")
    for i, e in enumerate(g, 1):
        print(f"| {i} | {e['t_wall'][11:19]} | {e['hand_mm']:.2f} | {e['commanded_mm']:g} | {e['margin_mm']:.2f} | "
              f"{'a vuoto' if e.get('empty') else 'presa'} | {'sì' if i in vuote else ''} |")
    print()
    for nome, s in (("con la provetta", tenuto), ("a vuoto", vuoto)):
        if s:
            m = [e["margin_mm"] for e in s]
            print(f"- **{nome}**: n={len(m)}, margine mediano {st.median(m):.2f} mm, "
                  f"intervallo {min(m):.2f}–{max(m):.2f} mm")
    if vuoto and tenuto:
        top_v = max(e["margin_mm"] for e in vuoto)
        bot_t = min(e["margin_mm"] for e in tenuto)
        print(f"\nA vuoto arriva al massimo a {top_v:.2f} mm, con la provetta parte da {bot_t:.2f} mm: "
              + (f"la soglia {tol:g} mm separa i due gruppi." if top_v <= tol < bot_t else
                 "**la soglia NON separa i due gruppi**: " +
                 ("i gruppi si sovrappongono." if top_v >= bot_t else "cade fuori dall'intervallo libero.")))
    elif not vuoto:
        print("\nNessuna presa segnata come a vuoto (--vuote): non si puo' dire se la soglia separa.")
    print()


def sez_arresti(ev):
    print("## Arresti richiesti dall'operatore\n")
    fatti = [e for e in ev if e["kind"] == "stop_done"]
    if not fatti:
        print("Nessun arresto registrato.\n")
        return
    t = [e["elapsed_s"] for e in fatti]
    print(f"{len(fatti)} arresti. Dal clic alla conferma di halt: mediana {st.median(t):.3f} s, "
          f"massimo {max(t):.3f} s. Halt confermato dal braccio: "
          f"{sum(1 for e in fatti if e['hardware_halt_ok'] is True)}, "
          f"non confermato: {sum(1 for e in fatti if e['hardware_halt_ok'] is False)}, "
          f"nessun nodo hardware: {sum(1 for e in fatti if e['hardware_halt_ok'] is None)}.")
    print("\nE' la latenza software fino alla conferma: il tempo che il braccio impiega a fermarsi "
          "davvero si legge solo dal video.\n")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("log")
    ap.add_argument("--vuote", default="", help="posizioni 1-based delle prese a vuoto, es. 3,7,9")
    a = ap.parse_args()
    ev = carica(a.log)
    vuote = {int(x) for x in a.vuote.split(",") if x.strip()}
    print(f"# Misure sul robot — {a.log}\n\n{len(ev)} righe: "
          + ", ".join(f"{k} {n}" for k, n in Counter(e["kind"] for e in ev).most_common()) + "\n")
    runs = cicli(ev)
    sez_cicli(runs)
    sez_corrispondenza(runs)
    sez_arrivi(ev)
    sez_prese(ev, vuote)
    sez_arresti(ev)
    return 0


if __name__ == "__main__":
    sys.exit(main())
