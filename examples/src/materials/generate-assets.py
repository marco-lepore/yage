"""Generate the example's PNG images, with numeric maps written exactly."""
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

def noise(x, y):
    """Repeatable grain in -1..1, so every run writes the same bytes."""
    return ((x * 73856093 ^ y * 19349663) % 1000) / 500 - 1

def floor(x, y):
    """A stone slab with dark grout on two edges, so each joint between tiles shows one grout line."""
    if x < 2 or y < 2:
        return (38, 36, 40, 255)
    shade = 92 + round(noise(x, y) * 6)
    return (shade, shade - 4, shade - 10, 255)

BEVEL = 8
GROOVES = (21, 42)

def crate_normal_xy(x, y):
    """Bevelled edges tilt outward and plank grooves dip, in OpenGL green-up."""
    nx = ny = 0.0
    if x < BEVEL:
        nx = -0.6
    elif x >= 64 - BEVEL:
        nx = 0.6
    if y < BEVEL:
        ny = 0.6
    elif y >= 64 - BEVEL:
        ny = -0.6
    if nx != 0:
        return nx, ny
    for groove in GROOVES:
        if groove - 2 <= y < groove:
            ny = -0.5
        elif groove <= y < groove + 2:
            ny = 0.5
    return nx, ny

def crate(x, y):
    edge = x < BEVEL or x >= 64 - BEVEL or y < BEVEL or y >= 64 - BEVEL
    groove = any(g - 2 <= y < g + 2 for g in GROOVES)
    base = (150, 104, 60) if edge else (176, 124, 72)
    darken = 0.7 if groove and not edge else 1
    grain = noise(x // 3, y) * 8
    return tuple(max(0, min(255, round(c * darken + grain))) for c in base) + (255,)

def crate_normal(x, y):
    nx, ny = crate_normal_xy(x, y)
    nz = math.sqrt(max(0, 1 - nx * nx - ny * ny))
    return tuple(round((v + 1) * 127.5) for v in (nx, ny, nz)) + (255,)

OUT.mkdir(parents=True, exist_ok=True)
for role in ("color", "normal", "specular", "emission"):
    png(f"orb-{role}.png", 64, lambda x, y: sample(x, y, role))
    png(f"orb-{role}-sheet.png", 128, lambda x, y: sample(x, y, role))
png("orb-specular-color.png", 64, lambda x, y: sample(x, y, "specular-color"))
png("floor.png", 64, floor)
png("crate.png", 64, crate)
png("crate-normal.png", 64, crate_normal)
