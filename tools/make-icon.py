"""Render the existing あ brand mark into Windows icon sizes."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
FONT = Path('C:/Windows/Fonts/msgothic.ttc')
if not FONT.exists():
    raise SystemExit('A Japanese-capable font is required to regenerate the icon.')
size = 1024
image = Image.new('RGBA', (size, size), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=280, fill='#285f49')
font = ImageFont.truetype(str(FONT), 690)
draw.text((size / 2, size / 2 - 14), 'あ', font=font, anchor='mm', fill='white')
image.resize((256, 256), Image.Resampling.LANCZOS).save(ROOT / 'assets' / 'app.png')
image.save(ROOT / 'assets' / 'app.ico', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
print('Generated assets/app.png and assets/app.ico')
