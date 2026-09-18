"""The example in Copilot's opening line must name things that exist.

Run:
    PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 poetry run python -m pytest testing/test_chat_example_resolves.py -v

The empty state read: «pick up the flask and place it in the rack». There is no
flask in the catalogue — the objects are tubes and a medicine bottle — and the
destination is "tube rack", not "rack". So the first sentence a first-time
operator reads is an instruction that does not work: typed verbatim it makes the
assistant either report a missing object or invent one.

Bad anywhere; worse in a study, where one task is deliberately chat-only and a
failure on the very first turn reads as the participant's failure rather than
the example's.

The example is the one piece of chat copy whose nouns have to agree with the
database, so it is the one piece a test can check. It is compared against
seed_library.py, which is what actually creates them.
"""
import os
import re

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CHAT = os.path.join(ROOT, "frontend", "src", "utils", "chat.ts")
FAQ = os.path.join(ROOT, "frontend", "src", "pages", "faq", "index.tsx")
SEED = os.path.join(ROOT, "backend", "management", "commands", "seed_library.py")


def _read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def _strip_comments(source):
    """Drop // and /* */.

    Not optional here: the comment that records WHY the example changed has to
    quote the wrong example to be worth reading, and without this the test
    matched its own explanation and reported the defect it documents as still
    present.
    """
    source = re.sub(r"/\*.*?\*/", "", source, flags=re.DOTALL)
    return re.sub(r"//[^\n]*", "", source)


def _catalogue_names():
    """Every object and location name seed_library.py creates.

    Read from the seeding command rather than from the database: db.sqlite3 is
    reverted between study participants, so the command is what the next
    session actually starts from.
    """
    src = _read(SEED)
    # `"name": "blue tube",` — the shape every catalogue entry uses.
    return {n.lower() for n in re.findall(r'"name":\s*"([^"]+)"', src)}


def _example(text):
    """The quoted example, between the first pair of quote marks."""
    m = re.search(r"[“\"&ldquo;]([^“”\"]*?(?:pick up|place)[^“”\"]*?)[”\"&rdquo;]", text)
    return m.group(1) if m else None


def test_the_seed_is_still_readable():
    """A parser that silently returns nothing turns every check below into a
    vacuous pass."""
    names = _catalogue_names()
    assert len(names) >= 8, f"lette solo {len(names)} voci dal catalogo: {names}"
    assert "blue tube" in names and "sample tray" in names


@pytest.mark.parametrize("path", [CHAT, FAQ])
def test_the_example_names_only_things_that_exist(path):
    names = _catalogue_names()
    text = _strip_comments(_read(path))

    assert "flask" not in text.lower(), (
        "l'esempio nomina di nuovo una 'flask': nel catalogo non esiste, e "
        "chi la digita riceve un errore o una proposta inventata."
    )

    # The nouns the example actually uses, checked against the catalogue. Only
    # multi-word names are matched: a bare "tube" is a real object, so
    # substring-matching single words would pass on any text containing it.
    used = [n for n in names if " " in n and n in text.lower()]
    assert used, (
        "l'esempio non nomina piu' nessuna entita' del catalogo: senza un "
        "nome reale non insegna all'operatore come si chiama ciò che vede "
        "nella Libreria."
    )
