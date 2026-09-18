#!/usr/bin/env python3
"""Genera le tabelle LaTeX delle appendici B e C a partire dalle fonti reali.

Perche' generate e non scritte a mano. La tesi ha gia' dichiarato «ventitre
moduli di test» quando erano cinquantacinque: il numero era corretto quando e'
stato scritto ed e' scaduto in silenzio. Queste due appendici contano cose che
crescono a ogni commit — i casi dell'insieme di riferimento, i moduli di prova,
le configurazioni misurate — e una tabella che nessuno ricalcola scade allo
stesso modo. Si rigenerano con:

    poetry run python testing/gen_appendix_tables.py --out ~/dtblockly_tesi/9-Appendici/gen

Le fonti:
  appendice B  testing/eval_llm_cases.jsonl  +  testing/out/*.json
  appendice C  testing/test_*.py  +  ros2_ws/src/cobotta_rest_api/test/test_*.py

Ogni file emesso porta in testa la data e il comando che lo ha prodotto, cosi'
che una tabella vecchia si riconosca guardandola.
"""

import argparse
import ast
import datetime
import glob
import json
import os
import re
import statistics

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

CATEGORIE = {
    "core": "Centrale",
    "hallucination_guard": "Allucinazioni",
    "nested_logic": "Logica annidata",
    "codeswitch": "Alternanza di lingua",
    "long_sequence": "Sequenza lunga",
    "condition_variant": "Variante di condizione",
    "combo": "Combinato",
}
ORDINE = list(CATEGORIE)


def esc(t):
    """Neutralizza i caratteri che LaTeX interpreta.

    La barra rovesciata non puo' essere sostituita per prima con la propria
    macro: quella macro contiene graffe, e il ciclo che protegge le graffe le
    riscriverebbe subito dopo producendo \\textbackslash\\{\\}, che non
    compila. Si passa percio' da un segnaposto che nessuno dei caratteri
    protetti puo' produrre, e lo si scioglie alla fine.
    """
    SEGNAPOSTO = "\x00BSLASH\x00"
    t = str(t).replace("\\", SEGNAPOSTO)
    for c in "&%$#_{}":
        t = t.replace(c, "\\" + c)
    t = t.replace("~", "\\textasciitilde{}").replace("^", "\\textasciicircum{}")
    return t.replace(SEGNAPOSTO, "\\textbackslash{}")


def intestazione(comando):
    oggi = datetime.date.today().isoformat()
    return (f"% Generato da testing/gen_appendix_tables.py il {oggi}.\n"
            f"% Non modificare a mano: rigenerare con\n"
            f"%   {comando}\n")


# --------------------------------------------------------------------------
# Appendice B
# --------------------------------------------------------------------------

def carica_casi():
    p = os.path.join(HERE, "eval_llm_cases.jsonl")
    with open(p, encoding="utf-8") as f:
        return [json.loads(r) for r in f if r.strip()]


def carica_risultati():
    """Stessa regola dello strumento di analisi: fuori le prove di collaudo,
    fuori chi non ha una copertura multipla di 49."""
    merged = {}
    for p in sorted(glob.glob(os.path.join(HERE, "out", "*.json"))):
        if "smoke" in os.path.basename(p):
            continue
        with open(p, encoding="utf-8") as f:
            d = json.load(f)
        for spec, rows in d.items():
            if isinstance(rows, list) and rows and isinstance(rows[0], dict):
                merged.setdefault(spec, []).extend(rows)
    return merged


def breve(spec):
    label = spec.split(":", 1)[1]
    return label + " (nothink)" if spec.startswith("ollama-nothink") else label


def tabella_casi(casi, comando):
    righe = []
    for cat in ORDINE:
        dentro = [c for c in casi if c.get("category") == cat]
        if not dentro:
            continue
        righe.append("\\multicolumn{4}{l}{\\textbf{%s} (%d casi)} \\\\[2pt]"
                     % (esc(CATEGORIE[cat]), len(dentro)))
        for c in dentro:
            e = c.get("expect", {})
            tipi = ", ".join(e.get("task_types") or []) or "---"
            righe.append("\\texttt{%s} & %s & %s & \\texttt{%s} \\\\" % (
                esc(c["name"]), esc(c.get("lang", "")).upper(),
                esc(e.get("intent", "")), esc(tipi)))
        righe.append("\\addlinespace")
    corpo = "\n".join(righe)
    return intestazione(comando) + r"""
\begin{longtable}{@{}>{\raggedright\arraybackslash}p{4.6cm}cl>{\raggedright\arraybackslash}p{5.1cm}@{}}
\caption[I 49 casi dell'insieme di riferimento]{I 49 casi dell'insieme di riferimento, per categoria. Per ciascuno si riportano l'identificatore, la
lingua della richiesta, l'intento atteso e i tipi di passo che la risposta deve produrre. Il testo delle richieste sta in
\texttt{testing/eval\_llm\_cases.jsonl}.}\label{tab:app-casi}\\
\toprule
\textbf{Caso} & \textbf{Lingua} & \textbf{Intento} & \textbf{Tipi di passo attesi} \\
\midrule
\endfirsthead
\toprule
\textbf{Caso} & \textbf{Lingua} & \textbf{Intento} & \textbf{Tipi di passo attesi} \\
\midrule
\endhead
\bottomrule
\endlastfoot
""" + corpo + "\n\\end{longtable}\n"


def _tasso(rows):
    return 100.0 * sum(1 for r in rows if r.get("pass")) / len(rows) if rows else 0.0


def tabella_categorie(res, comando):
    righe = []
    for spec in sorted(res, key=lambda s: (s.startswith("ollama"), -_tasso(res[s]))):
        rows = res[spec]
        celle = []
        for cat in ORDINE:
            sub = [r for r in rows if (r.get("category") or "") == cat]
            celle.append(f"{_tasso(sub):.0f}" if sub else "---")
        righe.append("\\texttt{%s} & %.1f & %s \\\\" % (
            esc(breve(spec)), _tasso(rows), " & ".join(celle)))
    n = [str(sum(1 for c in carica_casi() if c.get("category") == k)) for k in ORDINE]
    return intestazione(comando) + r"""
\begin{longtable}{@{}>{\raggedright\arraybackslash}p{4.3cm}r*{7}{r}@{}}
\caption[Accuratezza per categoria, tutte le configurazioni]{Accuratezza per categoria e configurazione, in percentuale, su tutte le 24 configurazioni
misurate, comprese le due locali minime che le figure del Capitolo~\ref{chap:verifica-tecnica} lasciano fuori. I remoti in alto, i locali sotto,
ciascun gruppo per accuratezza decrescente. Il numero di casi per categoria e' in intestazione: su una o due prove un valore di 0 o 100 indica
presenza o assenza del comportamento, non una frequenza.}\label{tab:app-categorie}\\
\toprule
& \textbf{Tot.} & \multicolumn{7}{c}{\textbf{per categoria}} \\
\cmidrule(l){3-9}
\textbf{Configurazione} & \textbf{\%} & \textbf{Cen} & \textbf{All} & \textbf{Ann} & \textbf{Lin} & \textbf{Seq} & \textbf{Var} & \textbf{Com} \\
& & """ + " & ".join(f"{{\\footnotesize {x}}}" for x in n) + r""" \\
\midrule
\endfirsthead
\toprule
\textbf{Configurazione} & \textbf{\%} & \textbf{Cen} & \textbf{All} & \textbf{Ann} & \textbf{Lin} & \textbf{Seq} & \textbf{Var} & \textbf{Com} \\
\midrule
\endhead
\bottomrule
\endlastfoot
""" + "\n".join(righe) + "\n\\end{longtable}\n"


def tabella_esecuzione(res, comando):
    """Latenza, consegna e stabilita': le tre grandezze che non stanno nella
    tabella dell'accuratezza e che il capitolo cita per pochi modelli."""
    righe = []
    for spec in sorted(res, key=lambda s: (s.startswith("ollama"), -_tasso(res[s]))):
        rows = res[spec]
        lat = sorted(r["latency_ms"] for r in rows if "latency_ms" in r)
        mediana = statistics.median(lat) / 1000 if lat else float("nan")
        p90 = lat[int(0.9 * (len(lat) - 1))] / 1000 if lat else float("nan")
        mancate = sum(1 for r in rows if r.get("error"))
        consegnate = [r for r in rows if not r.get("error")]
        t_cons = _tasso(consegnate)
        per_caso = {}
        for r in rows:
            per_caso.setdefault(r["name"], []).append(bool(r.get("pass")))
        variabili = sum(1 for v in per_caso.values() if len(set(v)) > 1)
        righe.append("\\texttt{%s} & %d & %d & %.1f & %.1f & %.1f & %d \\\\" % (
            esc(breve(spec)), len(rows), mancate, t_cons, mediana, p90, variabili))
    return intestazione(comando) + r"""
\begin{longtable}{@{}>{\raggedright\arraybackslash}p{4.3cm}rrrrrr@{}}
\caption[Consegna, latenza e stabilita' per configurazione]{Chiamate effettuate, risposte mai arrivate, accuratezza sulle sole risposte consegnate,
latenza mediana e al novantesimo percentile, e numero di casi il cui esito cambia fra le esecuzioni. Il protocollo prevede 245 chiamate: le due righe
che ne portano meno sono quelle discusse nella Sezione~\ref{sec:consegna}.}\label{tab:app-esecuzione}\\
\toprule
\textbf{Configurazione} & \textbf{Chiam.} & \textbf{Mancate} & \textbf{\% cons.} & \textbf{Med. (s)} & \textbf{p90 (s)} & \textbf{Var.} \\
\midrule
\endfirsthead
\toprule
\textbf{Configurazione} & \textbf{Chiam.} & \textbf{Mancate} & \textbf{\% cons.} & \textbf{Med. (s)} & \textbf{p90 (s)} & \textbf{Var.} \\
\midrule
\endhead
\bottomrule
\endlastfoot
""" + "\n".join(righe) + "\n\\end{longtable}\n"


# --------------------------------------------------------------------------
# Appendice C
# --------------------------------------------------------------------------

DIRS_TEST = [
    ("backend", os.path.join(ROOT, "testing")),
    ("ROS", os.path.join(ROOT, "ros2_ws", "src", "cobotta_rest_api", "test")),
]


def moduli_di_prova():
    """Un modulo conta se definisce almeno una funzione di prova. La cartella
    testing/ ospita anche script diagnostici che si chiamano test_*.py e non
    contengono prove: pytest non li raccoglie, e non devono comparire qui."""
    out = []
    for lato, d in DIRS_TEST:
        for p in sorted(glob.glob(os.path.join(d, "test_*.py"))):
            src = open(p, encoding="utf-8").read()
            try:
                albero = ast.parse(src)
            except SyntaxError:
                continue
            funzioni = [n for n in ast.walk(albero)
                        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
                        and n.name.startswith("test")]
            if not funzioni:
                continue
            doc = ast.get_docstring(albero) or ""
            # La prima frase del docstring dichiara la proprieta' difesa.
            prima = re.split(r"(?<=[.!?])\s", doc.strip().replace("\n", " "))[0] if doc else ""
            # Tre moduli su cinquantotto hanno una prima frase lunga oltre 160
            # caratteri, e tutti e tre hanno la forma «proprieta': elenco di
            # casi». In tabella serve la proprieta', non l'elenco, quindi si
            # taglia ai due punti. E' una regola, non un troncamento: sotto
            # quella soglia la frase resta intera anche se contiene due punti.
            if len(prima) > 160 and ":" in prima:
                prima = prima.split(":", 1)[0] + "."
            out.append({
                "lato": lato,
                "file": os.path.basename(p),
                "n": len(funzioni),
                "proprieta": prima.strip(),
            })
    return out


def tabella_moduli(moduli, comando):
    righe = []
    for lato in ("backend", "ROS"):
        dentro = [m for m in moduli if m["lato"] == lato]
        if not dentro:
            continue
        righe.append("\\multicolumn{3}{l}{\\textbf{Lato %s} (%d moduli, %d funzioni)} \\\\[2pt]"
                     % (esc(lato), len(dentro), sum(m["n"] for m in dentro)))
        for m in dentro:
            p = m["proprieta"] or "\\emph{(nessuna dichiarazione nel modulo)}"
            righe.append("\\texttt{%s} & %d & %s \\\\" % (
                esc(m["file"].replace("test_", "").replace(".py", "")), m["n"],
                p if p.startswith("\\emph") else esc(p)))
        righe.append("\\addlinespace")
    return intestazione(comando) + r"""
\begin{longtable}{@{}>{\raggedright\arraybackslash}p{4.2cm}r>{\raggedright\arraybackslash}p{8.0cm}@{}}
\caption[Moduli della suite e proprieta' difesa]{I moduli della suite di prova, con il numero di funzioni di prova che ciascuno contiene e la
proprieta' che dichiara di difendere. Il testo della colonna di destra e' la prima frase del commento di intestazione del modulo, ripresa alla
lettera: dove manca, il modulo non la dichiara.}\label{tab:app-moduli}\\
\toprule
\textbf{Modulo} & \textbf{Fn.} & \textbf{Proprieta' difesa} \\
\midrule
\endfirsthead
\toprule
\textbf{Modulo} & \textbf{Fn.} & \textbf{Proprieta' difesa} \\
\midrule
\endhead
\bottomrule
\endlastfoot
""" + "\n".join(righe) + "\n\\end{longtable}\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True, help="cartella dove scrivere i .tex")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    # Il comando in testa ai file generati e' quello che un lettore della tesi
    # puo' ripetere: percorso della cartella nel repository della tesi, non
    # quello assoluto della macchina su cui la generazione e' avvenuta.
    comando = ("poetry run python testing/gen_appendix_tables.py "
               "--out <repo-tesi>/9-Appendici/gen")

    casi = carica_casi()
    res = carica_risultati()
    if not casi or not res:
        print("fonti mancanti: servono eval_llm_cases.jsonl e testing/out/*.json")
        return 1
    moduli = moduli_di_prova()

    files = {
        "casi.tex": tabella_casi(casi, comando),
        "categorie.tex": tabella_categorie(res, comando),
        "esecuzione.tex": tabella_esecuzione(res, comando),
        "moduli.tex": tabella_moduli(moduli, comando),
    }
    for nome, testo in files.items():
        with open(os.path.join(args.out, nome), "w", encoding="utf-8") as f:
            f.write(testo)
        print(f"  scritto {nome}")
    print(f"\n  {len(casi)} casi, {len(res)} configurazioni, "
          f"{len(moduli)} moduli ({sum(m['n'] for m in moduli)} funzioni)")
    senza = [m["file"] for m in moduli if not m["proprieta"]]
    if senza:
        print(f"  moduli senza proprieta' dichiarata: {len(senza)} -> {', '.join(senza[:5])}"
              + (" ..." if len(senza) > 5 else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
