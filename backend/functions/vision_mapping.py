"""
Mapping from user-facing object names to YOLO COCO class names.

YOLOv8 pretrained (yolov8n.pt) uses the 80 COCO classes.
Object names in DTblocklyGPT tasks may be in Italian or lab-specific terms;
this mapping translates them to the corresponding COCO class name.

If a name is already a COCO class, it passes through unchanged.
If no mapping is found, the original name is returned and a warning is logged.
"""

import logging

logger = logging.getLogger(__name__)

# Italian/lab name → COCO class name
_OBJECT_TO_COCO: dict[str, str] = {
    # Lab glassware (demo scenario)
    "provetta": "bottle",
    "flask": "bottle",
    "flacone": "bottle",
    "bottiglia": "bottle",
    "tappo": "cup",
    "tazza": "cup",
    "bicchiere": "cup",
    "contenitore": "bowl",
    "ciotola": "bowl",
    # Fruit / food
    "mela": "apple",
    "banana": "banana",
    # Common lab/workshop objects
    "forbici": "scissors",
    "libro": "book",
    "telefono": "cell phone",
    "laptop": "laptop",
    "tastiera": "keyboard",
    "mouse": "mouse",
    "borsa": "handbag",
    "sedia": "chair",
    "tavolo": "dining table",
}

# All 80 COCO class names (yolov8n.pt)
_COCO_CLASSES = {
    "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train",
    "truck", "boat", "traffic light", "fire hydrant", "stop sign",
    "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep", "cow",
    "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella", "handbag",
    "tie", "suitcase", "frisbee", "skis", "snowboard", "sports ball", "kite",
    "baseball bat", "baseball glove", "skateboard", "surfboard", "tennis racket",
    "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana",
    "apple", "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza",
    "donut", "cake", "chair", "couch", "potted plant", "bed", "dining table",
    "toilet", "tv", "laptop", "mouse", "remote", "keyboard", "cell phone",
    "microwave", "oven", "toaster", "sink", "refrigerator", "book", "clock",
    "vase", "scissors", "teddy bear", "hair drier", "toothbrush",
}


# Colour keywords (Italian/English) recognized inside object names, mapped to
# the colour names emitted by the vision node (cap_color.COLOR_BINS keys).
_COLOR_KEYWORDS: dict[str, str] = {
    "blu": "blue",
    "blue": "blue",
    "giallo": "yellow",
    "gialla": "yellow",
    "yellow": "yellow",
    "rosso": "red",
    "rossa": "red",
    "red": "red",
    "verde": "green",
    "green": "green",
}


def parse_object_query(name: str) -> tuple[str, str | None]:
    """Split an object name into (coco_class, color | None).

    "provetta blu" → ("bottle", "blue"); "blue flask" → ("bottle", "blue");
    "mela" → ("apple", None). The first colour keyword found is extracted,
    the remaining words go through to_coco_class unchanged.
    """
    color = None
    words = []
    for word in name.lower().strip().split():
        if color is None and word in _COLOR_KEYWORDS:
            color = _COLOR_KEYWORDS[word]
        else:
            words.append(word)
    base = " ".join(words) if words else name
    return to_coco_class(base), color


def to_coco_class(name: str) -> str:
    """Return the COCO class name for a given object name.

    Lookup order:
    1. Name is already a COCO class → return as-is
    2. Name found in mapping dict → return mapped class
    3. Lowercase version found → return mapped class
    4. Not found → log warning, return original name
    """
    if name in _COCO_CLASSES:
        return name

    lower = name.lower().strip()

    if lower in _COCO_CLASSES:
        return lower

    if lower in _OBJECT_TO_COCO:
        return _OBJECT_TO_COCO[lower]

    logger.warning(
        "vision_mapping: no COCO mapping for '%s' — using as-is. "
        "Add it to _OBJECT_TO_COCO if needed.",
        name,
    )
    return name
