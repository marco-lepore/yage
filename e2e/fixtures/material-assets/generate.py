"""Exact PNG values for the material GPU probes; alpha-zero maps stay numeric."""
from pathlib import Path
import struct
import zlib

OUT = Path(__file__).parent


def png(name, width, pixel):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    rows = b"".join(b"\0" + bytes(c for x in range(width) for c in pixel(x, y)) for y in range(32))
    OUT.joinpath(name).write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, 32, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b""))


png("gray.png", 32, lambda x, y: (128, 128, 128, 255))
png("red.png", 32, lambda x, y: (255, 0, 0, 255))
png("left.png", 32, lambda x, y: (0, 128, 128, 0))
png("right.png", 32, lambda x, y: (255, 128, 128, 0))
png("up.png", 32, lambda x, y: (128, 255, 128, 0))
png("specular.png", 32, lambda x, y: (0 if x < 16 else 255, 0, 0, 0))
png("atlas-normal.png", 32, lambda x, y: (0 if x < 12 else 255, 128, 128, 0))
png("sheet.png", 64, lambda x, y: (128, 128, 128, 255))
png("sheet-normal.png", 64, lambda x, y: (0 if x < 32 else 255, 128, 128, 0))
