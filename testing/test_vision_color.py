"""Cap-colour check — does each tube come back with the right colour?

Give it the colours on the bench, left to right, and it says for every tube how
often it was found, how often the colour was right, and what a wrong one was
taken for. That is the confusion matrix the perception chapter needs, and it
needs no bookkeeping by hand:

    poetry run python testing/test_vision_color.py --atteso giallo,verde,blu --etichetta base

Defaults are the production ones: the bench camera, YOLOE with the single class
"test tube", confidence 0.20 (the value vision_node runs at). Colour names are
the classifier's: yellow, green, blue, red — Italian aliases are accepted.

Two ways to feed it:

  live      20 snapshots ~0.5 s apart from the camera. They are NOT independent
            samples: the scene does not change between them, so this measures
            stability against camera noise. The variation that matters is
            BETWEEN conditions (light, geometry), so run it once per condition.
  saved     --image a.png b.png ...  one pass over each file, no camera. Each
            image is one sample, and this is the way to compare conditions from
            frames already saved by scan_recognition_check.py --save-raw.

The stock-YOLOv8n gate this file used to be (the V6 verdict on tube detection
rate) is still available: --model yolov8n.pt --classes "" and no --atteso.

Not a pytest module on purpose: no test functions, needs a live camera or files.
The pure parts (assegna, matrice) are tested in test_vision_color_matrix.py.
"""

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.abspath(os.path.join(
    os.path.dirname(__file__), "..", "ros2_ws", "src", "cobotta_rest_api")))

# Same three constants as scan_recognition_check.py — the bench camera.
DEFAULT_URL = "http://192.168.0.90/-wvhttp-01-/image.cgi"
DEFAULT_USER = "admin"
DEFAULT_PASS = "password"

TUBE_CLASSES = ("bottle", "cup")   # stock YOLOv8n's names for a tube
GATE_THRESHOLD = 0.70
ALIAS = {"giallo": "yellow", "verde": "green", "blu": "blue", "rosso": "red",
         "arancione": "orange", "viola": "purple"}
NESSUN_COLORE, NON_TROVATA = "(nessun colore)", "(non trovata)"


def _grabber(source, user, password):
    import cv2
    import numpy as np

    if source.startswith("http://") or source.startswith("https://"):
        import requests
        from requests.auth import HTTPDigestAuth

        auth = HTTPDigestAuth(user, password) if user else None

        def grab():
            resp = requests.get(source, auth=auth, timeout=3.0)
            resp.raise_for_status()
            return cv2.imdecode(np.frombuffer(resp.content, np.uint8), cv2.IMREAD_COLOR)

        return grab

    cap = cv2.VideoCapture(int(source) if source.isdigit() else source)
    if not cap.isOpened():
        sys.exit(f"Camera '{source}' not open")

    def grab():
        ok, frame = cap.read()
        return frame if ok else None

    return grab


# ── pure parts ────────────────────────────────────────────────────────────────

def riferimenti(frames, n):
    """Left-to-right x centres of the tubes, from the first frame that shows all n.

    The expected colours come in bench order, but a frame can lose a tube, and
    then "the second detection" is the wrong tube. Anchoring slots to positions
    seen in a complete frame keeps every later detection on its own tube.
    """
    for dets in frames:
        if len(dets) == n:
            return sorted(d["xc"] for d in dets)
    return None


def assegna(dets, refs):
    """Map detections to slots by nearest reference x. Returns (slots, extras).

    `slots` is {slot index: detection}; two detections on one slot keep the more
    confident and send the other to `extras`, as does one too far from any slot.
    """
    if len(refs) > 1:
        tol = 0.6 * min(b - a for a, b in zip(refs, refs[1:]))
    else:
        tol = 100.0
    slots, extras = {}, []
    for d in sorted(dets, key=lambda d: -d["conf"]):
        j = min(range(len(refs)), key=lambda k: abs(refs[k] - d["xc"]))
        if abs(refs[j] - d["xc"]) <= tol and j not in slots:
            slots[j] = d
        else:
            extras.append(d)
    return slots, extras


def assegna_libero(dets):
    """One tube that moves between slots: the most confident detection is it.

    `assegna` anchors each detection to a bench position seen in the first
    complete frame and sends anything farther than 60% of the slot pitch to
    `extras`. With one tube walked across four slots that discards every frame
    but the ones in the first slot — the analysis would report "not found" for
    a tube that was found.
    """
    if not dets:
        return {}, []
    best = max(dets, key=lambda d: d["conf"])
    return {0: best}, [d for d in dets if d is not best]


def matrice(esiti, atteso):
    """Confusion matrix rows=expected colour, cols=what came back (or missing)."""
    m = {a: {} for a in dict.fromkeys(atteso)}
    for j, quel in esiti:
        riga = m[atteso[j]]
        riga[quel] = riga.get(quel, 0) + 1
    return m


# ── run ───────────────────────────────────────────────────────────────────────

def rileva(yolo, frame, conf, tube_classes, cc):
    """Detections with cap colour, the way vision_node computes them.

    Detection runs on the raw frame; the colour comes from a gray-world
    white-balanced copy made ONCE per frame, with the local background hue
    sampled around the box. Skipping either gives the wrong answer, and the
    first version of this rewrite did: classifying the raw crop under the
    lab's warm cast returned "orange" for all three tubes. The earlier version
    of this script had the same gap — it predates the white-balance step, which
    is why its colour counts could not be trusted.
    """
    wb_frame = cc.normalize_white_balance(frame)
    out = []
    for result in yolo(frame, conf=conf, verbose=False):
        for box in result.boxes:
            name = result.names[int(box.cls[0])]
            if name not in tube_classes:
                continue
            xyxy = [float(v) for v in box.xyxy[0]]
            bg_hue = cc.sample_background_hue(wb_frame, xyxy)
            color = cc.classify_hsv(cc.cap_region(wb_frame, xyxy), background_hue=bg_hue)
            out.append({"name": name, "conf": float(box.conf[0]), "color": color,
                        "xc": (xyxy[0] + xyxy[2]) / 2.0})
    return out


def main(args):
    from ultralytics import YOLO

    from cobotta_rest_api import cap_color as cc

    atteso = [ALIAS.get(c.strip().lower(), c.strip().lower())
              for c in args.atteso.split(",") if c.strip()]
    classes = [c.strip() for c in args.classes.split(",") if c.strip()]
    yolo = YOLO(args.model)
    if classes:
        try:
            yolo.set_classes(classes)
        except AttributeError:
            print(f"{args.model} has no set_classes (not open-vocabulary) — ignoring --classes")
            classes = []
    tube_classes = set(classes) if classes else set(TUBE_CLASSES)

    if args.image:
        import cv2
        frames_src = [(p, cv2.imread(p)) for p in args.image]
        for p, f in frames_src:
            if f is None:
                sys.exit(f"cannot read {p}")
        grab = None
    else:
        grab = _grabber(args.source, args.user, args.password)
        frames_src = [(f"frame {i + 1}", None) for i in range(args.frames)]

    per_frame, grabbed, blob_colors = [], 0, {}
    for i, (nome, frame) in enumerate(frames_src):
        if grab:
            frame = grab()
            time.sleep(args.delay)
        if frame is None:
            print(f"{nome:>10}: GRAB FAILED")
            continue
        grabbed += 1
        dets = rileva(yolo, frame, args.conf, tube_classes, cc)
        if args.blob:
            for b in cc.detect_cap_blobs(cc.normalize_white_balance(frame)):
                blob_colors[b["color"]] = blob_colors.get(b["color"], 0) + 1
        per_frame.append((nome, dets))
        print(f"{nome:>10}: " + (" ".join(
            f"[x{d['xc']:.0f} {d['color'] or '-'} {d['conf']:.2f}]"
            for d in sorted(dets, key=lambda d: d['xc'])) or "-"))
    if not grabbed:
        sys.exit("No frames grabbed — check camera source/credentials.")

    with_tube = sum(1 for _, d in per_frame if d)
    print(f"\n=== {args.etichetta or 'senza etichetta'} — {args.model}, conf {args.conf}, "
          f"{grabbed} {'immagini' if args.image else 'frame'} ===")
    print(f"frame con almeno una provetta: {with_tube}/{grabbed} ({with_tube / grabbed:.0%})")

    if not atteso:
        rate = with_tube / grabbed
        print("VERDICT (gate V6, senza --atteso): "
              + ("crop-bbox over YOLO stays PRIMARY." if rate >= GATE_THRESHOLD else "HSV blob path is PRIMARY."))
        return 0

    if args.libera and len(atteso) != 1:
        sys.exit("--libera vale per una sola provetta: usa --atteso con un solo colore.")
    refs = [0.0] if args.libera else riferimenti([d for _, d in per_frame], len(atteso))
    if refs is None:
        print(f"Non ho mai visto tutte e {len(atteso)} le provette in uno stesso frame: "
              "non posso ancorare le posizioni. Controlla --atteso e la scena.")
        return 1
    esiti, extras, conf_per_slot = [], 0, {j: [] for j in range(len(atteso))}
    for _, dets in per_frame:
        slots, extra = assegna_libero(dets) if args.libera else assegna(dets, refs)
        extras += len(extra)
        for j in range(len(atteso)):
            d = slots.get(j)
            if d is None:
                esiti.append((j, NON_TROVATA))
            else:
                esiti.append((j, d["color"] or NESSUN_COLORE))
                conf_per_slot[j].append(d["conf"])

    print("\nPosizioni: " + ("libera (una provetta, qualunque alloggiamento)" if args.libera else ", ".join(
        f"{j + 1}=x{x:.0f} {atteso[j]}" for j, x in enumerate(refs))))
    print(f"\n{'posizione':<10}{'atteso':<9}{'trovata':<9}{'colore ok':<11}{'conf media (min–max)':<24}sbagliata come")
    risultato = []
    for j, col in enumerate(atteso):
        mio = [q for jj, q in esiti if jj == j]
        trov = [q for q in mio if q != NON_TROVATA]
        ok = sum(1 for q in mio if q == col)
        sbagl = {}
        for q in trov:
            if q != col:
                sbagl[q] = sbagl.get(q, 0) + 1
        cs = conf_per_slot[j]
        cstr = f"{sum(cs) / len(cs):.2f} ({min(cs):.2f}–{max(cs):.2f})" if cs else "—"
        print(f"{j + 1:<10}{col:<9}{len(trov)}/{len(mio):<7}{ok}/{len(mio):<9}{cstr:<24}"
              + (", ".join(f"{k} ×{v}" for k, v in sbagl.items()) or "—"))
        risultato.append({"slot": j + 1, "atteso": col, "trovata": len(trov), "frame": len(mio),
                          "colore_ok": ok, "sbagliata_come": sbagl,
                          "conf": {"media": sum(cs) / len(cs) if cs else None,
                                   "min": min(cs) if cs else None, "max": max(cs) if cs else None}})
    m = matrice(esiti, atteso)
    cols = list(dict.fromkeys(atteso + [q for r in m.values() for q in r]))
    for extra in (NESSUN_COLORE, NON_TROVATA):
        if extra in cols:
            cols.remove(extra)
            cols.append(extra)
    print("\nMatrice di confusione (righe = atteso, colonne = risposta)")
    print(f"{'':<10}" + "".join(f"{c:<16}" for c in cols))
    for a, riga in m.items():
        print(f"{a:<10}" + "".join(f"{riga.get(c, 0):<16}" for c in cols))
    if extras:
        print(f"\nRilevazioni fuori posizione (falsi positivi o doppie): {extras}")
    if args.blob:
        print(f"\nBlob HSV (percorso di riserva, rumoroso sul portaprovette rosso): {blob_colors or '-'}")
    tot = len(esiti)
    print(f"\nTotale: {sum(1 for j, q in esiti if q == atteso[j])}/{tot} provette con colore corretto "
          f"({sum(1 for _, q in esiti if q == NON_TROVATA)} non trovate).")
    if args.out:
        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump({"etichetta": args.etichetta, "model": args.model, "conf": args.conf,
                       "atteso": atteso, "frames": grabbed, "slots": risultato,
                       "matrice": m, "fuori_posizione": extras}, f, ensure_ascii=False, indent=1)
        print(f"Salvato in {args.out}")
    return 0


def parse(argv):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("source", nargs="?", default=DEFAULT_URL, help="camera URL or index (default: bench camera)")
    ap.add_argument("user", nargs="?", default=DEFAULT_USER)
    ap.add_argument("password", nargs="?", default=DEFAULT_PASS)
    ap.add_argument("--atteso", default="", help="colours left to right, e.g. giallo,verde,blu")
    ap.add_argument("--etichetta", default="", help="condition name, e.g. base, torcia, laterale")
    ap.add_argument("--model", default="yoloe-11s-seg.pt")
    ap.add_argument("--classes", default="test tube", help='"" for the stock model')
    ap.add_argument("--conf", type=float, default=0.20, help="vision_node runs at 0.20")
    ap.add_argument("--frames", type=int, default=20)
    ap.add_argument("--delay", type=float, default=0.5)
    ap.add_argument("--image", nargs="+", help="saved frames instead of the camera")
    ap.add_argument("--libera", action="store_true",
                    help="one tube moved between slots: no position anchoring (needs a single --atteso colour)")
    ap.add_argument("--blob", action="store_true", help="also count HSV blobs (noisy on the red rack)")
    ap.add_argument("--out", default="", help="write the result as JSON")
    return ap.parse_args(argv)


if __name__ == "__main__":
    sys.exit(main(parse(sys.argv[1:])))
