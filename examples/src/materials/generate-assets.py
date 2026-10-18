"""Generate the example's numeric PNG maps with no image color conversion."""
from pathlib import Path
import math
import struct
import zlib

OUT = Path(__file__).resolve().parents[2] / "public/assets/materials"

def png(name, width, pixel):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    rows = b"".join(b"\0" + bytes(channel for x in range(width) for channel in pixel(x, y)) for y in range(64))
    OUT.joinpath(name).write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, 64, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b""))

def sample(x, y, role):
    frame, x = divmod(x, 64)
    nx, ny = (x - 31.5) / 28, (y - 31.5) / 28
    radius = nx * nx + ny * ny
    alpha = round(max(0, min(1, (1 - math.sqrt(radius)) * 28)) * 255)
    stripe = abs(y - (20 if frame == 0 else 40)) < 3
    glossy = x > 24
    if role == "color":
        return (80, 155, 180, alpha)
    if role == "specular-color":
        return ((190, 195, 205) if glossy else (155, 85, 40)) + (alpha,)
    if role == "normal":
        nz = math.sqrt(max(0, 1 - min(radius, 1)))
        return tuple(round((max(-1, min(1, v)) + 1) * 127.5) for v in (nx, -ny, nz)) + (255,)
    if role == "specular":
        return (220 if glossy else 40,) * 3 + (255,)
    return ((80, 255, 160) if stripe else (0, 0, 0)) + (255,)

OUT.mkdir(parents=True, exist_ok=True)
for role in ("color", "normal", "specular", "emission"):
    png(f"orb-{role}.png", 64, lambda x, y: sample(x, y, role))
    png(f"orb-{role}-sheet.png", 128, lambda x, y: sample(x, y, role))
png("orb-specular-color.png", 64, lambda x, y: sample(x, y, "specular-color"))
