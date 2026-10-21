# Generates assets/foto.jpg: a synthetic ~10 KB photo-like JPEG (sunset over sea and hills),
# drawn procedurally so it carries no third-party rights. python3 tools/gen/foto.py
import numpy as np
from PIL import Image, ImageFilter
W, H = 320, 240
rng = np.random.default_rng(2026)
y, x = np.mgrid[0:H, 0:W].astype(float)
sky = np.stack([255 - 0.3 * y, 140 + 0.4 * y, 90 + 0.6 * y], -1)
sun = np.exp(-(((x - 210) ** 2 + (y - 95) ** 2) / 300.0))[..., None] * np.array([0, 90, 120])
img = sky + sun
hill = 120 + 18 * np.sin(x / 37.0) + 9 * np.sin(x / 13.0 + 1)
img[(y > hill) & (y <= 170)] = np.array([40, 70, 45])
sea = y > 170
img[sea] = (np.stack([30 + 0.2 * y, 80 + 0.3 * y, 130 + 0.4 * y], -1))[sea]
glint = sea & (np.abs(x - 210) < 25 - (y - 170) * 0.1) & (rng.random((H, W)) > 0.6)
img[glint] = [255, 200, 120]
img += rng.normal(0, 6, img.shape)
im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).filter(ImageFilter.SMOOTH)
for q in range(95, 5, -1):
    im.save('assets/foto.jpg', 'JPEG', quality=q, optimize=True)
    import os
    if os.path.getsize('assets/foto.jpg') <= 10240:
        break
print('assets/foto.jpg', os.path.getsize('assets/foto.jpg'), 'bytes, quality', q)
