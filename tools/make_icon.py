"""生成 Windows exe / 安卓启动图标：深蓝圆角底 + 白色音符。输出 windows/app.ico 与 docs/icon.png。"""
from PIL import Image, ImageDraw
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def rounded_bg(size, radius_ratio=0.22):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(size * radius_ratio)
    # 竖向渐变 #6f9bff -> #3f6fdd
    for y in range(size):
        t = y / max(1, size - 1)
        c = (int(0x6f + (0x3f - 0x6f) * t), int(0x9b + (0x6f - 0x9b) * t), int(0xff + (0xdd - 0xff) * t), 255)
        d.line([(0, y), (size, y)], fill=c)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=255)
    img.putalpha(mask)
    return img

def draw_note(img):
    size = img.size[0]
    d = ImageDraw.Draw(img)
    u = size / 100.0
    # 符头（两个椭圆）
    for cx, cy in ((36, 74), (64, 66)):
        d.ellipse([cx*u - 9*u, cy*u - 7*u, cx*u + 9*u, cy*u + 7*u], fill=(255, 255, 255, 255))
    # 符干
    d.rounded_rectangle([44*u, 30*u, 48*u, 70*u], radius=2*u, fill=(255, 255, 255, 255))
    d.rounded_rectangle([72*u, 24*u, 76*u, 62*u], radius=2*u, fill=(255, 255, 255, 255))
    # 符杠
    d.polygon([(44*u, 30*u), (76*u, 24*u), (76*u, 34*u), (44*u, 40*u)], fill=(255, 255, 255, 255))
    return img

big = draw_note(rounded_bg(256))
big.save(os.path.join(ROOT, "docs", "icon.png"))
sizes = [16, 24, 32, 48, 64, 128, 256]
frames = [draw_note(rounded_bg(s)) for s in sizes]
frames[-1].save(os.path.join(ROOT, "windows", "app.ico"), format="ICO",
                sizes=[(s, s) for s in sizes], append_images=frames[:-1])
print("ok", os.path.getsize(os.path.join(ROOT, "windows", "app.ico")), "bytes ico")
