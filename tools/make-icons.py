#!/usr/bin/env python3
"""Regenerate the PNG app icons from the same geometry as icon.svg.

    python tools/make-icons.py

The PNGs are checked in because Safari ignores an SVG apple-touch-icon and Android
wants a maskable one. Stdlib only — no Pillow, no build step.
"""
import io
import math
import os
import struct
import zlib

BG = (6, 8, 11)
CYAN = (99, 224, 255)
COPPER = (217, 155, 99)
RINGS = [(0.735, 0.039, 0.25), (0.563, 0.039, 0.40), (0.391, 0.039, 0.60)]
SS = 3  # supersampling factor


def render(path, size, maskable=False):
    w = size * SS
    scale = 0.78 if maskable else 1.0   # keep inside the maskable safe zone
    centre = w / 2
    rows = bytearray()
    for y in range(size):
        rows.append(0)  # PNG filter: none
        for x in range(size):
            acc = [0, 0, 0]
            for dy in range(SS):
                for dx in range(SS):
                    px, py = x * SS + dx + 0.5, y * SS + dy + 0.5
                    d = math.hypot(px - centre, py - centre) / (w / 2) / scale
                    r, g, b = BG
                    for rad, half, alpha in RINGS:
                        if abs(d - rad) < half:
                            r = int(r + (CYAN[0] - r) * alpha)
                            g = int(g + (CYAN[1] - g) * alpha)
                            b = int(b + (CYAN[2] - b) * alpha)
                    if d < 0.219:
                        r, g, b = CYAN
                    elif d < 0.25:
                        r, g, b = COPPER
                    acc[0] += r
                    acc[1] += g
                    acc[2] += b
            n = SS * SS
            rows += bytes((acc[0] // n, acc[1] // n, acc[2] // n, 255))

    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))

    blob = (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(bytes(rows), 9))
            + chunk(b'IEND', b''))
    io.open(path, 'wb').write(blob)
    print(f'{path}  {size}x{size}  {len(blob)} bytes')


if __name__ == '__main__':
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    render(os.path.join(root, 'icon-180.png'), 180)
    render(os.path.join(root, 'icon-192.png'), 192)
    render(os.path.join(root, 'icon-512.png'), 512)
    render(os.path.join(root, 'icon-maskable-512.png'), 512, maskable=True)
