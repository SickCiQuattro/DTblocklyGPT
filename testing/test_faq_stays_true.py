"""The help page must describe the system that exists, and stay out of the way
of the study it will be sitting next to.

Run:
    PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 poetry run python -m pytest testing/test_faq_stays_true.py -v

A reference page is the surface that rots fastest: nothing breaks when it goes
stale, so nothing tells you. This one had already drifted — it named a "Simulate"
control the panel does not have and gave an example with a "flask" that is not in
the catalogue — and it is reachable from every screen during a user session.

Two rules, both mechanical.
"""
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
FAQ = os.path.join(ROOT, "frontend", "src", "pages", "faq", "index.tsx")
DICTIONARY = os.path.join(
    ROOT, "frontend", "src", "features", "blockly", "blocks", "blockTextDictionary.ts"
)
VOCABULARY = os.path.join(
    ROOT, "frontend", "src", "constants", "uiVocabulary.ts"
)


def _read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def _body(source):
    """The page's own prose, with the file's explanatory header removed.

    The header quotes the mistakes the page used to make, so matching against
    the whole file would find them and report a page that is already fixed.
    """
    return source[source.index("const Faq = ()"):]


def test_it_calls_things_what_the_screen_calls_them():
    """A reference whose vocabulary differs from the screen sends the reader
    hunting for a control that does not exist under that name. These are the
    names the app itself renders, read from the two dictionaries that own them.
    """
    page = _body(_read(FAQ))
    dictionary = _read(DICTIONARY)
    vocabulary = _read(VOCABULARY)

    for label in ("Pause and show message", "Show message and continue"):
        assert label in dictionary, (
            f"'{label}' non e' piu' l'etichetta nel dizionario dei blocchi: "
            "la pagina di aiuto la sta citando da un sistema che non esiste."
        )
        assert label in page, (
            f"la pagina non nomina piu' '{label}'. E' la distinzione centrale "
            "fra i due passi umani — uno aspetta, l'altro no."
        )

    for term in ("Test recognition", "Run on robot", "Start simulation"):
        assert term in vocabulary, f"'{term}' non e' piu' in UI_TEXT"
        assert term in page, (
            f"la pagina non usa piu' '{term}', che e' la parola stampata sul "
            "controllo."
        )


def test_it_does_not_name_controls_that_were_removed():
    """Each of these was on the page and each had already stopped being true."""
    page = _body(_read(FAQ))
    for gone, why in (
        ("flask", "nel catalogo non c'e' nessuna flask: l'esempio non funziona"),
        (
            "Simulate</b>",
            "il pannello dice 'Start simulation', non 'Simulate'",
        ),
    ):
        assert gone not in page, f"la pagina cita di nuovo '{gone}': {why}"


def test_it_does_not_answer_the_third_prediction_question():
    """This page is one click away from every screen, including during a study
    session.

    The third question asked before each run is "and if you do nothing, what
    happens?" — it exists to find out whether the operator has worked out on
    their own that the wait can end without them. A sentence here saying so
    would answer it, and the measurement would be of this paragraph rather than
    of the system. studio-utenti/03-script-sessione.md keeps the whole session
    silent on it for the same reason.
    """
    page = _body(_read(FAQ)).lower()
    for leak in ("time limit", "times out", "timeout", "expires", "seconds to"):
        assert leak not in page, (
            f"la pagina nomina '{leak}': risponde alla terza domanda di "
            "previsione dello studio, che chiede proprio cosa succede se "
            "l'operatore non fa nulla."
        )


def test_it_still_says_the_thing_that_prevents_a_real_mistake():
    """One paragraph on this page is not a reminder but a guard: Run uses the
    published version, not what is on screen. An operator who does not know
    that watches a task run and does not recognise it."""
    page = _body(_read(FAQ))
    assert re.search(r"Run always uses the published version", page), (
        "sparita la frase su cosa viene davvero eseguito: e' l'unico punto in "
        "cui la pagina previene un errore invece di descrivere un controllo."
    )
    assert "e-stop" in page, (
        "sparito l'avviso sull'arresto di emergenza: il pulsante Stop nel "
        "pannello non e' una funzione di sicurezza, e la pagina e' l'unico "
        "posto in cui questo viene detto per esteso."
    )
