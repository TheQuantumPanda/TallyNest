import os
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
os.chdir(ROOT)
from PIL import Image, ImageDraw, ImageFont

WIDTH = 840
HEIGHT = 540

SLIDES = [
    {
        "title": "Dashboard & Net Cash Flow",
        "file": "docs/screenshots/dashboard.png",
        "crop_top": 0,
    },
    {
        "title": "Personal Transaction Ledger",
        "file": "docs/screenshots/transactions-ledger.png",
        "crop_top": 0,
    },
    {
        "title": "Monthly Category Budgets",
        "file": "docs/screenshots/budget-management.png",
        "crop_top": 0,
    },
    {
        "title": "Recurring Transaction Engine",
        "file": "docs/screenshots/recurring-schedules.png",
        "crop_top": 0,
    },
    {
        "title": "Collaborative Group Workspace",
        "file": "docs/screenshots/group-workspace.png",
        "crop_top": 0,
    },
    {
        "title": "Two-Phase Cycle Settlement",
        "file": "docs/screenshots/cycle-workspace.png",
        "crop_top": 0,
    },
]

def prepare_slide(info):
    img = Image.open(info["file"]).convert("RGBA")

    # Calculate crop from 1440 width to match 840x540 aspect ratio
    target_aspect = WIDTH / HEIGHT
    crop_w = img.width
    crop_h = int(crop_w / target_aspect)

    top = info.get("crop_top", 0)
    if top + crop_h > img.height:
        crop_h = img.height - top
        crop_w = int(crop_h * target_aspect)
        left = (img.width - crop_w) // 2
    else:
        left = 0

    cropped = img.crop((left, top, left + crop_w, top + crop_h))
    resized = cropped.resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS)

    # Add subtle badge overlay in top-right corner
    overlay = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    title = info["title"]
    # Pill dimensions
    badge_w = 260
    badge_h = 32
    badge_x = WIDTH - badge_w - 20
    badge_y = 16

    # Semi-transparent dark pill with border
    draw.rounded_rectangle(
        [badge_x, badge_y, badge_x + badge_w, badge_y + badge_h],
        radius=16,
        fill=(15, 17, 26, 230),
        outline=(34, 41, 58, 255),
        width=1
    )

    # Mint status dot
    dot_r = 4
    dot_x = badge_x + 16
    dot_y = badge_y + badge_h // 2
    draw.ellipse(
        [dot_x - dot_r, dot_y - dot_r, dot_x + dot_r, dot_y + dot_r],
        fill=(131, 229, 213, 255)
    )

    # Font
    try:
        font = ImageFont.truetype("/usr/share/fonts/noto/NotoSans-Bold.ttf", 12)
    except:
        font = ImageFont.load_default()

    draw.text((badge_x + 28, badge_y + 8), title, fill=(240, 241, 245, 255), font=font)

    # Subtle dark card border for the entire image
    draw.rectangle([0, 0, WIDTH - 1, HEIGHT - 1], outline=(34, 41, 58, 200), width=1)

    final = Image.alpha_composite(resized, overlay)
    return final.convert("RGB")

def main():
    print("Preparing slide images...")
    processed_slides = [prepare_slide(s) for s in SLIDES]

    temp_dir = tempfile.mkdtemp(prefix="tallynest-preview-")
    print(f"Generating frames in {temp_dir}...")

    frame_idx = 0
    # Hold frames: 2.0s hold per slide, crossfade: 2 frames of 120ms
    # To keep GIF compact and responsive, we can set frame delays in ffmpeg or write out frames
    # Let's write frames: 1 frame per hold with delay, or sequence of frames
    # In ffmpeg, an image sequence with a concat file or varying durations:
    # Or write frames at 8 FPS:
    # 2.0s hold = 16 frames. 6 slides * 16 frames = 96 frames total!
    # That is very clean and compact!

    FPS = 6
    HOLD_FRAMES = 12  # 2.0s
    FADE_FRAMES = 2   # ~0.33s

    for i in range(len(processed_slides)):
        curr_slide = processed_slides[i]
        next_slide = processed_slides[(i + 1) % len(processed_slides)]

        # Hold
        for _ in range(HOLD_FRAMES):
            frame_path = os.path.join(temp_dir, f"frame_{frame_idx:04d}.png")
            curr_slide.save(frame_path)
            frame_idx += 1

        # Crossfade
        for f in range(1, FADE_FRAMES + 1):
            alpha = f / (FADE_FRAMES + 1)
            blended = Image.blend(curr_slide, next_slide, alpha)
            frame_path = os.path.join(temp_dir, f"frame_{frame_idx:04d}.png")
            blended.save(frame_path)
            frame_idx += 1

    print(f"Total frames generated: {frame_idx}. Encoding GIF with ffmpeg...")
    output_path = "docs/media/tallynest-preview.gif"
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        "ffmpeg", "-y",
        "-framerate", str(FPS),
        "-i", os.path.join(temp_dir, "frame_%04d.png"),
        "-filter_complex", "split[s0][s1];[s0]palettegen=max_colors=128:reserve_transparent=0[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle",
        "-loop", "0", output_path
    ]
    subprocess.run(cmd, check=True)

    # Layer optimize with magick
    subprocess.run(["magick", output_path, "-layers", "Optimize", output_path], check=True)

    size_kb = os.path.getsize(output_path) / 1024
    print(f"Generated: {output_path} ({size_kb:.1f} KB)")

    # Cleanup
    for f in os.listdir(temp_dir):
        os.remove(os.path.join(temp_dir, f))
    os.rmdir(temp_dir)

if __name__ == "__main__":
    main()
