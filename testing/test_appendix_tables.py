"""Il generatore delle appendici deve produrre LaTeX valido e contare davvero.

Le due appendici generate esistono perche' un numero scritto a mano scade in
silenzio, e questo file esiste perche' anche un generatore puo' scadere in
silenzio: se l'escaping perde un carattere il documento non compila, e se il
conteggio dei moduli si scolla da quello dell'esecutore la tesi torna a
dichiarare un numero sbagliato con l'aria di averlo calcolato.
"""

import ast
import glob
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import gen_appendix_tables as gen  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _righe(tex, colonne):
    """Le righe di dati di una tabella: `colonne` celle, cioe' `colonne - 1`
    separatori, e chiusura di riga."""
    return [r for r in tex.splitlines()
            if r.rstrip().endswith("\\\\") and r.count(" & ") == colonne - 1
            and not r.lstrip().startswith(("\\multicolumn", "\\textbf"))]


def test_esc_neutralizza_ogni_carattere_speciale():
    # La barra rovesciata va sostituita per prima: se l'ordine si invertisse,
    # \textbackslash{} verrebbe riscritta dalle sostituzioni di { e }.
    assert gen.esc("a_b") == "a\\_b"
    assert gen.esc("100%") == "100\\%"
    assert gen.esc("a\\b") == "a\\textbackslash{}b"
    assert gen.esc("{x}") == "\\{x\\}"
    assert gen.esc("a&b#c$d") == "a\\&b\\#c\\$d"
    assert gen.esc("~^") == "\\textasciitilde{}\\textasciicircum{}"
    # Nessun carattere speciale deve sopravvivere non protetto.
    out = gen.esc("_%$#&{}~^\\")
    assert "\\textbackslash{}" in out
    for c in "_%$#&":
        assert out.count(c) == out.count("\\" + c)


def test_ogni_modulo_di_prova_ha_una_riga():
    """Il conteggio del generatore e' quello che la tesi cita: deve coincidere
    con i file che definiscono davvero una funzione di prova, non con il glob."""
    moduli = gen.moduli_di_prova()
    nomi = {m["file"] for m in moduli}

    attesi = set()
    for d in (os.path.join(ROOT, "testing"),
              os.path.join(ROOT, "ros2_ws", "src", "cobotta_rest_api", "test")):
        for p in glob.glob(os.path.join(d, "test_*.py")):
            albero = ast.parse(open(p, encoding="utf-8").read())
            if any(isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
                   and n.name.startswith("test") for n in ast.walk(albero)):
                attesi.add(os.path.basename(p))

    assert nomi == attesi
    assert all(m["n"] > 0 for m in moduli)
    # test_vision_color.py e' un gate da eseguire sull'hardware e non definisce
    # funzioni: l'esecutore non lo raccoglie, e la tabella non deve elencarlo.
    assert "test_vision_color.py" not in nomi


def test_la_regola_dei_due_punti_scatta_solo_sopra_la_soglia():
    """La prima frase resta intera anche se contiene due punti: si taglia solo
    quando supera i 160 caratteri, ed e' una regola dichiarata in appendice,
    non un troncamento arbitrario."""
    moduli = gen.moduli_di_prova()
    con_due_punti_corte = [m for m in moduli
                           if ":" in m["proprieta"] and len(m["proprieta"]) <= 160]
    assert con_due_punti_corte, "atteso almeno un modulo con due punti e frase corta"
    for m in moduli:
        assert len(m["proprieta"]) <= 161, (m["file"], len(m["proprieta"]))


def test_le_tabelle_generate_sono_bilanciate():
    casi = gen.carica_casi()
    assert len(casi) == 49
    tex = gen.tabella_casi(casi, "cmd")
    assert tex.count("\\begin{longtable}") == tex.count("\\end{longtable}") == 1
    # Una riga di dati si riconosce dal numero di separatori, non dal fatto che
    # cominci per \texttt: la didascalia, mandata a capo perche' non superi il
    # limite di lunghezza del sorgente, puo' finire una riga proprio cosi'.
    assert len(_righe(tex, 4)) == 49

    moduli = gen.moduli_di_prova()
    assert len(_righe(gen.tabella_moduli(moduli, "cmd"), 3)) == len(moduli)
