#!/usr/bin/env python3
"""Every number collected in a robot-measurement session, in one markdown file.

    poetry run python testing/tools/export_robot_data.py measures.jsonl --out DATA.md

Complements report_robot_measures.py, which SUMMARISES: this lists the rows the
summaries are computed from (every run, every arrival, every grasp, every stop),
adds the encoder-noise and colour-check JSON files from the same folder, and
appends the hand-written notes (percezione.md, sicurezza.md) verbatim, so the
file is the whole record and not a pointer to other files.
"""
import argparse
import json
import statistics as st
import sys
from datetime import date
from pathlib import Path


def carica(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(x) for x in f if x.strip()]


def tab(intest, righe):
    out = ["| " + " | ".join(intest) + " |", "| " + " | ".join("---" for _ in intest) + " |"]
    out += ["| " + " | ".join("" if c is None else str(c) for c in r) + " |" for r in righe]
    return out + [""]


def hms(e):
    return e["t_wall"][11:19]


def esecuzioni(ev):
    runs, cur = [], None
    for e in ev:
        k = e["kind"]
        if k == "run_start":
            cur = {"n": len(runs) + 1, "t": hms(e), "task": e.get("task_name"), "target": e.get("target"),
                   "t0": e["t_mono"], "pick": 0, "place": 0, "passi": [], "arrivi": [], "prese": []}
        elif cur is not None and k == "step":
            cur["passi"].append(e["block"])
            cur["pick"] += e["block"] == "pick_block" and e.get("target") == "real"
            cur["place"] += e["block"] == "place_block" and e.get("target") == "real"
        elif cur is not None and k == "hw_arrival":
            cur["arrivi"].append(e)
        elif cur is not None and k == "hw_grasp":
            cur["prese"].append(e)
        elif cur is not None and k == "run_end":
            cur.update(esito=e.get("outcome"), motivo=e.get("abort_reason") or "",
                       durata=round(e["t_mono"] - cur["t0"], 1))
            runs.append(cur)
            cur = None
    return runs


def sez_registro(ev, runs):
    L = ["## 1. Registro delle misure", ""]
    from collections import Counter
    L.append(f"{len(ev)} righe: " + ", ".join(f"{k} {n}" for k, n in Counter(e["kind"] for e in ev).most_common()) + ".")
    L.append("")
    L.append(f"Dal {ev[0]['t_wall'][:19]} al {ev[-1]['t_wall'][:19]} (UTC). Partecipante di registro: `{ev[0].get('participant')}`.")
    L.append("")
    L += ["### 1.1 Esecuzioni", ""]
    L += tab(["#", "ora", "compito", "target", "durata (s)", "esito", "prelievi", "depositi", "arrivi", "motivo"],
             [[r["n"], r["t"], r["task"], r["target"], r.get("durata"), r.get("esito"),
               r["pick"], r["place"], len(r["arrivi"]), r.get("motivo", "")[:90]] for r in runs])
    L += ["### 1.2 Sequenza dei passi per esecuzione", ""]
    L += tab(["#", "compito", "target", "passi"],
             [[r["n"], r["task"], r["target"], " > ".join(b.replace("_block", "") for b in r["passi"])] for r in runs])
    return L


def sez_arrivi(ev):
    a = [e for e in ev if e["kind"] == "hw_arrival" and e.get("max_delta_deg") is not None]
    L = ["## 2. Arrivi del braccio reale (scarto degli encoder)", ""]
    if not a:
        return L + ["Nessun arrivo.", ""]
    v = [e["max_delta_deg"] for e in a]
    v2 = sorted(v)
    L.append(f"{len(a)} arrivi, soglia {a[0]['tol_deg']:g}°. Scarto massimo fra i giunti per arrivo: mediana {st.median(v):.3f}°, "
             f"95° percentile {v2[int(0.95 * (len(v2) - 1))]:.3f}°, massimo {max(v):.3f}°. "
             f"Sopra 1°: {sum(x > 1 for x in v)}; sopra 1,9°: {sum(x >= 1.9 for x in v)}; oltre la soglia (arresti): {sum(not e['ok'] for e in a)}.")
    L.append("")
    L += tab(["#", "ora", "passo", "scarto max (°)", "giunto", "polls", "attesa (s)", "ok"],
             [[i, hms(e), e.get("step") or "—", f"{e['max_delta_deg']:.3f}",
               "J" + str(max(range(6), key=lambda j: e["deltas_deg"][j]) + 1), e["polls"], f"{e['wait_s']:.2f}",
               "sì" if e["ok"] else "**NO**"] for i, e in enumerate(a, 1)])
    return L


def sez_prese(ev):
    g = [e for e in ev if e["kind"] == "hw_grasp"]
    L = ["## 3. Larghezza della pinza dopo la chiusura", ""]
    L.append(f"{len(g)} righe `hw_grasp`, di cui {sum(e['hand_mm'] is not None for e in g)} con la larghezza letta. "
             "Le righe senza larghezza sono precedenti alla correzione di `HandCurPos` (chiamato sul robot invece che sul controller).")
    L.append("")
    L += tab(["#", "ora", "letta (mm)", "comandata (mm)", "margine (mm)", "soglia (mm)", "decisione"],
             [[i, hms(e) + (" (Stop)" if e.get("stopping") or (e["hand_mm"] or 0) >= 25 else ""),
               "—" if e["hand_mm"] is None else f"{e['hand_mm']:.3f}", e["commanded_mm"],
               "—" if e["margin_mm"] is None else f"{e['margin_mm']:.3f}", e["tol_mm"],
               "nessun dato" if e["empty"] is None else ("a vuoto" if e["empty"] else "presa")] for i, e in enumerate(g, 1)])
    return L


def sez_arresti(ev):
    L = ["## 4. Arresti richiesti dall'operatore", ""]
    d = [e for e in ev if e["kind"] == "stop_done"]
    r = [e for e in ev if e["kind"] == "stop_requested"]
    if not d:
        return L + ["Nessun arresto.", ""]
    t = [e["elapsed_s"] for e in d]
    L.append(f"{len(d)} arresti; dal clic alla conferma di halt: mediana {st.median(t):.3f} s, massimo {max(t):.3f} s. "
             "Latenza software: il tempo che il braccio impiega a fermarsi si legge dal video.")
    L.append("")
    L += tab(["#", "richiesto", "conferma", "clic→halt (s)", "halt dal braccio", "avviso"],
             [[i, hms(a), hms(b), b["elapsed_s"], b["hardware_halt_ok"], b["warning"]] for i, (a, b) in enumerate(zip(r, d), 1)])
    return L


def sez_umani(ev):
    L = ["## 5. Passi umani e tentativi", ""]
    righe = [[hms(e), e["kind"], e.get("condition") or e.get("channel") or "", e.get("value") or "",
              e.get("outcome") or e.get("accepted") or ""] for e in ev if e["kind"] in ("human_step_start", "human_step_end", "attempt")]
    return L + (tab(["ora", "riga", "condizione/canale", "valore", "esito"], righe) if righe else ["Nessuno.", ""])


def sez_json(cartella):
    L = ["## 6. Rumore degli encoder a riposo", ""]
    file_rumore = sorted(cartella.glob("rumore*.json"))
    if not file_rumore:
        L += ["Nessun `rumore*.json`.", ""]
    for p in file_rumore:
        d = json.load(open(p, encoding="utf-8"))
        L.append(f"**{p.name}** — {d['n']} letture in {d['seconds']:g} s a {d['hz']:g} Hz, {d['missing']} mancanti; soglia {d['tol_deg']:g}°. "
                 f"Posa: {[round(x, 3) for x in d['samples'][0]]}.")
        L.append("")
        L += tab(["giunto", "min", "max", "picco-picco", "dev. std", "valori distinti"],
                 [[j["joint"], f"{j['min']:.4f}", f"{j['max']:.4f}", f"{j['peak_to_peak']:.4f}", f"{j['stdev']:.4f}",
                   j["unique_values"]] for j in d["joints"]])
    L += ["## 7. Colore del tappo (serie dal vivo e immagini)", ""]
    for p in sorted(cartella.glob("colore-*.json")):
        nome = p.name
        d = json.load(open(p, encoding="utf-8"))
        L.append(f"**{nome}** — {d.get('etichetta') or ''}, {d['model']}, soglia {d['conf']}, {d['frames']} "
                 f"{'frame' if d['etichetta'] in ('base',) else 'immagini'}; atteso {d['atteso']}.")
        L.append("")
        L += tab(["posizione", "atteso", "trovata", "colore ok", "sbagliata come", "conf media", "min", "max"],
                 [[s["slot"], s["atteso"], f"{s['trovata']}/{s['frame']}", f"{s['colore_ok']}/{s['frame']}",
                   s["sbagliata_come"] or "—", *(["—"] * 3 if s["conf"]["media"] is None else
                   [f"{s['conf']['media']:.3f}", f"{s['conf']['min']:.2f}", f"{s['conf']['max']:.2f}"])]
                  for s in d["slots"]])
    return L


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("log")
    ap.add_argument("--out", default="")
    a = ap.parse_args()
    ev = carica(a.log)
    cartella = Path(a.log).parent
    runs = esecuzioni(ev)
    L = [f"# Dati raccolti sul robot fisico — {date.today():%d/%m/%Y}", "",
         f"Generato da `testing/tools/export_robot_data.py` da `{Path(a.log).name}`. Orari UTC (locali = UTC+2). "
         "Il riepilogo interpretativo è in `RISULTATI.md`; qui ci sono le righe da cui si calcola.", ""]
    for f in (lambda: sez_registro(ev, runs), lambda: sez_arrivi(ev), lambda: sez_prese(ev), lambda: sez_arresti(ev),
              lambda: sez_umani(ev), lambda: sez_json(cartella)):
        L += f()
    for titolo, nome in (("Percezione: rilevatori e condizioni di luce", "percezione.md"),
                         ("Arresto e sicurezza: note e osservazioni", "sicurezza.md"),
                         ("Riepilogo interpretativo", "RISULTATI.md")):
        p = cartella / nome
        if p.is_file():
            L += [f"## Allegato — {titolo}", "", f"_Copia di `{nome}`._", ""]
            # demote its headings by two levels so the file keeps one outline
            for riga in p.read_text(encoding="utf-8").splitlines():
                L.append(("###" + riga) if riga.startswith("#") else riga)
            L.append("")
    testo = "\n".join(L)
    if a.out:
        Path(a.out).write_text(testo, encoding="utf-8")
        print(f"scritto {a.out} ({len(L)} righe)")
    else:
        print(testo)
    return 0


if __name__ == "__main__":
    sys.exit(main())
