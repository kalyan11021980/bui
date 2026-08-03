"""Render synthetic licence cards with exact ground-truth boxes.

Three assets:
  card_<dpi>.png    an AAMVA-ish licence at a real physical size, so every
                    point size on it corresponds to real printed type.
  ladder_<dpi>.png  a point-size ladder, 5pt to 12pt, to find the size at
                    which DeepSeek-OCR stops reading after the 500px resize.
  <ratio>.png       calibration cards carrying four edge markers, rendered at
                    three aspect ratios to separate the two fit models.

The card and ladder emit boxes normalised 0-1000 (DeepSeek-OCR's own grounding
scale), so a returned box compares without rescaling. The calibration cards
emit TRUE PIXEL boxes instead: the mapping back into pixel space is the thing
under test, so normalising the truth would assume the answer.
"""

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parents[2] / "sample" / "licenses" / "synthetic"
OUT.mkdir(parents=True, exist_ok=True)

CALIB_OUT = Path(__file__).resolve().parents[2] / "sample" / "licenses" / "calibration"
CALIB_OUT.mkdir(parents=True, exist_ok=True)

# A US licence card is 3.375in x 2.125in (ID-1, ISO/IEC 7810).
CARD_W_IN, CARD_H_IN = 3.375, 2.125

FONT_DIRS = [
    "/System/Library/Fonts/Supplemental/",
    "/System/Library/Fonts/",
]


def font(name: str, pt: float, dpi: int) -> ImageFont.FreeTypeFont:
    """Load a font at a size that is physically correct for `dpi`."""
    px = round(pt * dpi / 72)
    for d in FONT_DIRS:
        p = Path(d) / name
        if p.exists():
            return ImageFont.truetype(str(p), px)
    raise FileNotFoundError(f"no font {name}")


def font_px(name: str, px: int) -> ImageFont.FreeTypeFont:
    """Load a font at an exact pixel size, for assets with no physical size."""
    for d in FONT_DIRS:
        p = Path(d) / name
        if p.exists():
            return ImageFont.truetype(str(p), px)
    raise FileNotFoundError(f"no font {name}")


BOLD = "Arial Bold.ttf"
REG = "Arial.ttf"


def render_card(dpi: int) -> dict:
    """An AAMVA-ish Georgia licence. Field values are obvious placeholders."""
    W, H = round(CARD_W_IN * dpi), round(CARD_H_IN * dpi)
    img = Image.new("RGB", (W, H), "#eef2f5")
    d = ImageDraw.Draw(img)

    # Banner
    d.rectangle([0, 0, W, round(H * 0.14)], fill="#1b3a6b")
    d.text((round(W * 0.03), round(H * 0.028)), "GEORGIA",
           font=font(BOLD, 13, dpi), fill="white")
    d.text((round(W * 0.42), round(H * 0.045)), "DRIVER'S LICENSE",
           font=font(BOLD, 8, dpi), fill="#c8d8ee")

    # Portrait placeholder
    px0, py0 = round(W * 0.03), round(H * 0.20)
    px1, py1 = round(W * 0.30), round(H * 0.78)
    d.rectangle([px0, py0, px1, py1], fill="#b9c4cf", outline="#8d99a6")
    d.text((px0 + round(W * 0.045), py0 + round(H * 0.26)), "PHOTO",
           font=font(REG, 7, dpi), fill="#4a5560")

    truth: dict[str, dict] = {}

    def field(label: str, value: str, key: str, x: float, y: float,
              label_pt: float = 5.0, value_pt: float = 9.0) -> None:
        """Draw a labelled field and record the value's box as 0-1000."""
        lx, ly = round(W * x), round(H * y)
        d.text((lx, ly), label, font=font(REG, label_pt, dpi), fill="#5a6672")
        f = font(BOLD, value_pt, dpi)
        vy = ly + round(label_pt * dpi / 72) + round(H * 0.012)
        d.text((lx, vy), value, font=f, fill="#101418")
        x0, y0, x1, y1 = d.textbbox((lx, vy), value, font=f)
        truth[key] = {
            "value": value,
            "printed_pt": value_pt,
            "box": [
                round(x0 / W * 1000), round(y0 / H * 1000),
                round(x1 / W * 1000), round(y1 / H * 1000),
            ],
        }

    # Right column. Point sizes chosen to match real cards: the DLN and name
    # are the largest data, the secondary dates are the small print.
    field("4d  DLN", "049-12-3456", "dl_number", 0.335, 0.20, value_pt=10.5)
    field("1  LN", "SPECIMEN", "last_name", 0.335, 0.335, value_pt=9.0)
    field("2  FN", "JAMIE ALEX", "first_name", 0.335, 0.445, value_pt=9.0)
    field("8  ADDRESS", "1400 PEACHTREE ST NE", "addr_line1", 0.335, 0.555,
          value_pt=7.0)
    field("", "ATLANTA, GA 30309", "addr_city_state_zip", 0.335, 0.635,
          value_pt=7.0)

    # Bottom row: the genuinely small print.
    field("3  DOB", "08/31/1982", "dob", 0.335, 0.745, value_pt=7.5)
    field("4b  EXP", "08/31/2029", "expiry", 0.560, 0.745, value_pt=7.5)
    field("4a  ISS", "07/02/2025", "issued", 0.775, 0.745, value_pt=7.5)

    field("15 SEX", "F", "sex", 0.335, 0.875, value_pt=6.5)
    field("16 HGT", "5-06", "height", 0.450, 0.875, value_pt=6.5)
    field("18 EYES", "BRO", "eyes", 0.585, 0.875, value_pt=6.5)
    field("12 REST", "NONE", "restrictions", 0.735, 0.875, value_pt=6.5)

    path = OUT / f"card_{dpi}.png"
    img.save(path, dpi=(dpi, dpi))
    return {
        "image": path.name,
        "dpi": dpi,
        "px": [W, H],
        "card_in": [CARD_W_IN, CARD_H_IN],
        "fields": truth,
    }


LADDER_PTS = [12, 10.5, 9, 8, 7, 6, 5]
# Distinct, non-guessable strings: a model must READ these, not infer them.
LADDER_TEXT = {
    12: "K7Q219-4830",
    10.5: "M3X845-7261",
    9: "T9B406-1957",
    8: "R2N738-6042",
    7: "W5L192-8374",
    6: "D8H563-2915",
    5: "P4V027-9186",
}


def render_ladder(dpi: int) -> dict:
    """Same physical width as a card, so the 500px resize hits it identically."""
    W = round(CARD_W_IN * dpi)
    line_h = round(0.30 * dpi / 72 * 72)  # ~0.30in per line
    H = line_h * (len(LADDER_PTS) + 1)
    img = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(img)

    truth = {}
    y = round(line_h * 0.4)
    for pt in LADDER_PTS:
        f = font(BOLD, pt, dpi)
        text = LADDER_TEXT[pt]
        x = round(W * 0.06)
        d.text((x, y), text, font=f, fill="black")
        x0, y0, x1, y1 = d.textbbox((x, y), text, font=f)
        # Right-hand caption at a legible size, naming the size under test.
        d.text((round(W * 0.62), y), f"{pt}pt", font=font(REG, 9, dpi),
               fill="#888888")
        truth[f"pt_{str(pt).replace('.', '_')}"] = {
            "value": text,
            "printed_pt": pt,
            "box": [
                round(x0 / W * 1000), round(y0 / H * 1000),
                round(x1 / W * 1000), round(y1 / H * 1000),
            ],
        }
        y += line_h

    path = OUT / f"ladder_{dpi}.png"
    img.save(path, dpi=(dpi, dpi))
    return {
        "image": path.name,
        "dpi": dpi,
        "px": [W, H],
        "card_in": [CARD_W_IN, H / dpi],
        "fields": truth,
    }


# Long, alphabetic, mutually dissimilar: `findValue` matches by containment, so
# a shared prefix would let one marker claim another's box.
CALIB_RATIOS = {
    "square": (1200, 1200),
    "landscape_16x10": (1600, 1000),
    "portrait_3x4": (900, 1200),
}


def render_calibration(name: str, W: int, H: int) -> dict:
    """Four markers at known pixel positions, one near each edge.

    The vertical pair is what separates the fit models: a letterbox band moves
    y and leaves x alone.
    """
    img = Image.new("RGB", (W, H), "#f4f6f8")
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W - 1, H - 1], outline="#9aa6b2", width=max(2, W // 400))

    f = font_px(BOLD, round(min(W, H) * 0.05))
    inset = round(min(W, H) * 0.03)

    placements = [
        ("MARKERNORTH", (W / 2, H * 0.05), "mm"),
        ("MARKERSOUTH", (W / 2, H * 0.95), "mm"),
        ("MARKERWEST", (inset, H / 2), "lm"),
        ("MARKEREAST", (W - inset, H / 2), "rm"),
    ]

    markers: dict[str, list[int]] = {}
    for text, xy, anchor in placements:
        d.text(xy, text, font=f, fill="#101418", anchor=anchor)
        x0, y0, x1, y1 = d.textbbox(xy, text, font=f, anchor=anchor)
        markers[text] = [round(x0), round(y0), round(x1), round(y1)]

    path = CALIB_OUT / f"{name}.png"
    img.save(path)
    return {
        "image": f"sample/licenses/calibration/{name}.png",
        "size": {"width": W, "height": H},
        "markers": markers,
    }


if __name__ == "__main__":
    calibration = [
        render_calibration(name, w, h) for name, (w, h) in CALIB_RATIOS.items()
    ]
    (CALIB_OUT / "truth.json").write_text(json.dumps(calibration, indent=2))
    for c in calibration:
        print(f"{Path(c['image']).name:22s} "
              f"{c['size']['width']}x{c['size']['height']}px  "
              f"{len(c['markers'])} markers")

    manifest = []
    # A sweep, not a sample. 600dpi is a generous scan; 150dpi is roughly a
    # 500px capture. Below that the card is smaller than anything the server
    # would resize it TO, so the last few find the floor at which reading
    # actually collapses — which is the number the upload control needs.
    for dpi in (600, 300, 150, 120, 100, 80, 60):
        manifest.append(render_card(dpi))
    manifest.append(render_ladder(600))

    (OUT / "ground_truth.json").write_text(json.dumps(manifest, indent=2))
    for m in manifest:
        print(f"{m['image']:20s} {m['px'][0]}x{m['px'][1]}px  "
              f"{len(m['fields'])} fields")
