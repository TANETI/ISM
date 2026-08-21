from pathlib import Path

from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "assets"

WORDMARKS = {
    "wordmark_ism.webp": {
        "text": "ISM 아카데미",
        "font": ROOT / "fonts" / "아카데미용 폰트" / "Hakgyoansim Chulseokbu TTF B.ttf",
        "fill": (226, 238, 248, 255),
        "stroke": (18, 42, 82, 190),
        "shadow": (106, 176, 255, 95),
    },
    "wordmark_pbs.webp": {
        "text": "원혈회",
        "font": ROOT / "fonts" / "원혈회용 폰트" / "빛의 계승자 Bold" / "TTF(Window용)" / "HeirofLightBold.ttf",
        "fill": (245, 214, 214, 255),
        "stroke": (90, 8, 18, 190),
        "shadow": (179, 19, 34, 120),
    },
    "wordmark_hprf.webp": {
        "text": "인간보전전선",
        "font": ROOT / "fonts" / "인간보전전선용 폰트" / "GANGWONSTATE-SemiBold.ttf",
        "fill": (222, 235, 245, 255),
        "stroke": (24, 48, 74, 190),
        "shadow": (85, 128, 170, 90),
    },
    "wordmark_wf.webp": {
        "text": "백색울타리",
        "font": ROOT / "fonts" / "백색울타리용 폰트" / "Asummerflowertree.ttf",
        "fill": (244, 242, 232, 255),
        "stroke": (90, 95, 100, 160),
        "shadow": (210, 216, 220, 80),
    },
    "wordmark_rtn.webp": {
        "text": "귀향파",
        "font": ROOT / "fonts" / "귀향파용 폰트" / "Hakgyoansim_JayeonR.ttf",
        "fill": (230, 216, 184, 255),
        "stroke": (62, 48, 26, 190),
        "shadow": (116, 88, 42, 110),
    },
    "wordmark_nf.webp": {
        "text": "언론·민간",
        "font": ROOT / "fonts" / "무소속용 폰트" / "Tenada.ttf",
        "fill": (232, 224, 205, 255),
        "stroke": (70, 62, 48, 160),
        "shadow": (170, 150, 110, 80),
    },
}


def supported_cmap(font_path):
    font = TTFont(font_path)
    cmap = set()
    for table in font["cmap"].tables:
        cmap.update(table.cmap.keys())
    return cmap


def validate_font(font_path, text):
    if not font_path.exists():
        raise FileNotFoundError(f"Specified font file not found: {font_path}")
    cmap = supported_cmap(font_path)
    missing_chars = [ch for ch in text if ch != " " and ord(ch) not in cmap]
    if missing_chars:
        missing = "".join(sorted(set(missing_chars)))
        raise RuntimeError(f"Specified font does not support '{text}': {font_path} / missing {missing}")


def load_font(font_path, size):
    try:
        return ImageFont.truetype(str(font_path), size)
    except Exception as exc:
        raise RuntimeError(f"Specified font loading failed: {font_path}") from exc


def fit_font(draw, text, font_path, max_width, max_height):
    size = 104
    while size >= 28:
        font = load_font(font_path, size)
        box = draw.textbbox((0, 0), text, font=font, stroke_width=2)
        width = box[2] - box[0]
        height = box[3] - box[1]
        if width <= max_width and height <= max_height:
            return font
        size -= 2
    return load_font(font_path, 28)


def create_wordmark(filename, spec):
    canvas_w, canvas_h = 760, 180
    margin_x, margin_y = 56, 30

    base = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(base)
    text = spec["text"]
    font_path = Path(spec["font"])
    validate_font(font_path, text)
    font = fit_font(draw, text, font_path, canvas_w - margin_x * 2, canvas_h - margin_y * 2)

    box = draw.textbbox((0, 0), text, font=font, stroke_width=2)
    text_w = box[2] - box[0]
    text_h = box[3] - box[1]
    x = (canvas_w - text_w) // 2 - box[0]
    y = (canvas_h - text_h) // 2 - box[1]

    shadow = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.text(
        (x, y + 2),
        text,
        font=font,
        fill=spec["shadow"],
        stroke_width=3,
        stroke_fill=spec["shadow"],
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(6))
    base.alpha_composite(shadow)

    draw = ImageDraw.Draw(base)
    draw.text(
        (x, y),
        text,
        font=font,
        fill=spec["fill"],
        stroke_width=2,
        stroke_fill=spec["stroke"],
    )

    bbox = base.getbbox()
    cropped = base.crop(bbox) if bbox else base

    pad_x, pad_y = 26, 16
    final = Image.new(
        "RGBA",
        (cropped.width + pad_x * 2, cropped.height + pad_y * 2),
        (0, 0, 0, 0),
    )
    final.alpha_composite(cropped, (pad_x, pad_y))
    out_path = OUT_DIR / filename
    final.save(out_path, "WEBP", lossless=True, quality=95, method=6)
    print(f"saved: {out_path.relative_to(ROOT)} {final.width}x{final.height}")


def main():
    for filename, spec in WORDMARKS.items():
        create_wordmark(filename, spec)


if __name__ == "__main__":
    main()
