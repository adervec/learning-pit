#!/usr/bin/env python3
"""Build the drawn modules: picture-words, counting, colours, shapes and flags.

    python tools/make-picture-module.py

The pictures are drawn here as tiny PNGs (stdlib only, no fonts, no downloads) so the module
works offline and ships in the repo. Shapes are deliberately simple and high-contrast, and the
ground is transparent so they sit on a dark pit or a daylight one equally well — which is why
the pale shapes (moon, egg, cloud) are toned down rather than near-white.
"""
import io, json, math, os, struct, zlib

SIZE = 160
BG = (0, 0, 0, 0)          # transparent: the app supplies the ground, whatever the theme


def rgba(col):
    return tuple(col) if len(col) == 4 else (*col, 255)


def png(pixels):
    rows = bytearray()
    for y in range(SIZE):
        rows.append(0)
        for x in range(SIZE):
            rows += bytes(pixels[y][x])
    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))
    blob = (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', SIZE, SIZE, 8, 6, 0, 0, 0))   # 6 = RGBA
            + chunk(b'IDAT', zlib.compress(bytes(rows), 9))
            + chunk(b'IEND', b''))
    import base64
    return 'data:image/png;base64,' + base64.b64encode(blob).decode()


def canvas():
    return [[list(BG) for _ in range(SIZE)] for _ in range(SIZE)]


def disc(px, cx, cy, r, col):
    for y in range(max(0, int(cy - r)), min(SIZE, int(cy + r) + 1)):
        for x in range(max(0, int(cx - r)), min(SIZE, int(cx + r) + 1)):
            if math.hypot(x - cx, y - cy) <= r:
                px[y][x] = list(rgba(col))


def box(px, x0, y0, x1, y1, col):
    for y in range(max(0, y0), min(SIZE, y1)):
        for x in range(max(0, x0), min(SIZE, x1)):
            px[y][x] = list(rgba(col))


def tri(px, cx, cy, h, col):
    for i in range(h):
        w = int(i * 0.9)
        box(px, cx - w, cy - h // 2 + i, cx + w, cy - h // 2 + i + 1, col)


def sun():
    px = canvas()
    disc(px, 80, 80, 44, (255, 208, 64))
    for k in range(12):
        a = k * math.pi / 6
        disc(px, 80 + math.cos(a) * 62, 80 + math.sin(a) * 62, 7, (255, 208, 64))
    return px


def moon():
    px = canvas()
    disc(px, 74, 80, 46, (206, 214, 232))
    disc(px, 100, 66, 40, BG)
    return px


def polygon(px, points, col):
    """Even-odd fill, so a five-pointed star comes out as a star and not a flower."""
    ys = [p[1] for p in points]
    for y in range(max(0, int(min(ys))), min(SIZE, int(max(ys)) + 1)):
        xs = []
        for i in range(len(points)):
            x0, y0 = points[i]
            x1, y1 = points[(i + 1) % len(points)]
            if (y0 <= y < y1) or (y1 <= y < y0):
                xs.append(x0 + (y - y0) * (x1 - x0) / (y1 - y0))
        xs.sort()
        for i in range(0, len(xs) - 1, 2):
            box(px, int(xs[i]), y, int(xs[i + 1]) + 1, y + 1, col)


def star():
    px = canvas()
    pts = []
    for k in range(10):
        a = -math.pi / 2 + k * math.pi / 5
        r = 62 if k % 2 == 0 else 26
        pts.append((80 + math.cos(a) * r, 80 + math.sin(a) * r))
    polygon(px, pts, (255, 226, 120))
    return px


def tree():
    px = canvas()
    box(px, 72, 90, 88, 140, (120, 78, 44))
    disc(px, 80, 74, 42, (76, 175, 96))
    return px


def house():
    px = canvas()
    box(px, 38, 78, 122, 140, (214, 196, 172))
    tri(px, 80, 62, 56, (176, 82, 66))
    box(px, 68, 104, 92, 140, (110, 78, 60))
    return px


def fish():
    px = canvas()
    disc(px, 74, 80, 36, (94, 190, 224))
    polygon(px, [(104, 80), (146, 50), (146, 110)], (94, 190, 224))   # tail, pointing right
    disc(px, 58, 70, 5, (18, 32, 44))                                  # eye
    return px


def egg():
    px = canvas()
    disc(px, 80, 92, 38, (232, 222, 198))
    disc(px, 80, 62, 28, (232, 222, 198))
    return px


def ball():
    px = canvas()
    disc(px, 80, 80, 46, (232, 116, 96))
    disc(px, 80, 80, 26, (250, 214, 206))
    return px


def leaf():
    px = canvas()
    # a leaf is two arcs meeting at a point: intersect two offset discs
    for y in range(SIZE):
        for x in range(SIZE):
            if math.hypot(x - 58, y - 58) <= 56 and math.hypot(x - 102, y - 102) <= 56:
                px[y][x] = [110, 190, 110, 255]
    box(px, 78, 100, 83, 146, (120, 100, 60))                          # stem
    return px


def cloud():
    px = canvas()
    disc(px, 62, 88, 26, (198, 210, 226))
    disc(px, 92, 88, 30, (198, 210, 226))
    disc(px, 78, 70, 26, (198, 210, 226))
    box(px, 40, 88, 122, 108, (198, 210, 226))
    return px


def apple():
    px = canvas()
    disc(px, 66, 90, 38, (214, 72, 66))
    disc(px, 96, 90, 38, (214, 72, 66))
    box(px, 78, 42, 84, 62, (110, 78, 44))                             # stalk
    polygon(px, [(84, 52), (116, 40), (104, 62)], (92, 168, 92))       # leaf
    return px


def boat():
    px = canvas()
    polygon(px, [(30, 104), (130, 104), (110, 136), (50, 136)], (196, 92, 72))   # hull
    box(px, 78, 34, 83, 104, (110, 78, 44))                            # mast
    polygon(px, [(84, 38), (128, 100), (84, 100)], (238, 238, 240))    # sail
    return px


def car():
    px = canvas()
    box(px, 24, 82, 136, 116, (86, 150, 216))
    polygon(px, [(52, 82), (74, 54), (110, 54), (122, 82)], (120, 176, 226))     # cabin
    disc(px, 52, 120, 16, (46, 52, 60))
    disc(px, 112, 120, 16, (46, 52, 60))
    return px


def cup():
    px = canvas()
    box(px, 110, 74, 134, 84, (108, 162, 208))                         # handle, drawn first
    box(px, 124, 74, 134, 112, (108, 162, 208))
    box(px, 110, 102, 134, 112, (108, 162, 208))
    box(px, 44, 56, 112, 132, (108, 162, 208))                         # the mug itself
    box(px, 50, 62, 106, 78, (238, 242, 246))                          # a band round the top
    return px


def flower():
    px = canvas()
    box(px, 78, 84, 83, 142, (96, 158, 88))                            # stem
    for k in range(6):
        a = k * math.pi / 3
        disc(px, 80 + math.cos(a) * 30, 66 + math.sin(a) * 30, 20, (226, 120, 168))
    disc(px, 80, 66, 18, (250, 214, 96))
    return px


def key():
    px = canvas()
    disc(px, 52, 80, 30, (226, 186, 84))
    disc(px, 52, 80, 13, BG)                                           # the hole
    box(px, 74, 72, 140, 88, (226, 186, 84))
    box(px, 116, 88, 126, 106, (226, 186, 84))                         # teeth
    box(px, 132, 88, 140, 102, (226, 186, 84))
    return px


# ---- shapes: one shape, one word ----

SHAPE_COLOUR = (108, 162, 208)


def shape_circle():
    px = canvas()
    disc(px, 80, 80, 56, SHAPE_COLOUR)
    return px


def shape_square():
    px = canvas()
    box(px, 26, 26, 134, 134, SHAPE_COLOUR)
    return px


def shape_triangle():
    px = canvas()
    polygon(px, [(80, 20), (140, 138), (20, 138)], SHAPE_COLOUR)
    return px


def shape_rectangle():
    px = canvas()
    box(px, 14, 46, 146, 114, SHAPE_COLOUR)
    return px


def shape_diamond():
    px = canvas()
    polygon(px, [(80, 14), (146, 80), (80, 146), (14, 80)], SHAPE_COLOUR)
    return px


def shape_star():
    px = canvas()
    pts = []
    for k in range(10):
        a = -math.pi / 2 + k * math.pi / 5
        r = 66 if k % 2 == 0 else 28
        pts.append((80 + math.cos(a) * r, 80 + math.sin(a) * r))
    polygon(px, pts, SHAPE_COLOUR)
    return px


def shape_heart():
    px = canvas()
    disc(px, 56, 60, 32, SHAPE_COLOUR)
    disc(px, 104, 60, 32, SHAPE_COLOUR)
    polygon(px, [(24, 72), (136, 72), (80, 146)], SHAPE_COLOUR)
    return px


def shape_oval():
    """A circle squashed on the way in: every row of a disc, scaled."""
    px = canvas()
    for y in range(SIZE):
        for x in range(SIZE):
            if ((x - 80) / 66) ** 2 + ((y - 80) / 40) ** 2 <= 1:
                px[y][x] = list(rgba(SHAPE_COLOUR))
    return px


SHAPES = [
    ('circle', shape_circle), ('square', shape_square), ('triangle', shape_triangle),
    ('rectangle', shape_rectangle), ('diamond', shape_diamond), ('star', shape_star),
    ('heart', shape_heart), ('oval', shape_oval),
]


# ---- colours: a plain patch of colour, and its name ----

COLOURS = [
    ('red', (214, 68, 60)), ('blue', (74, 140, 214)), ('yellow', (246, 202, 70)),
    ('green', (86, 176, 100)), ('orange', (238, 146, 66)), ('purple', (150, 110, 206)),
    ('pink', (232, 130, 178)), ('brown', (146, 104, 68)), ('grey', (150, 158, 166)),
    ('black', (28, 32, 38)), ('white', (250, 250, 250)),
]


def patch(col):
    px = canvas()
    box(px, 16, 16, SIZE - 16, SIZE - 16, col)
    return px


# ---- flags: bands, crosses and a disc — nothing that needs a font ----

def bands(cols, vertical=True):
    px = canvas()
    n = len(cols)
    for i, col in enumerate(cols):
        a, b = round(SIZE * i / n), round(SIZE * (i + 1) / n)
        if vertical:
            box(px, a, 22, b, SIZE - 22, col)
        else:
            box(px, 6, 22 + round((SIZE - 44) * i / n), SIZE - 6, 22 + round((SIZE - 44) * (i + 1) / n), col)
    return px


def nordic(ground, cross):
    """A Nordic cross: off-centre towards the hoist, as they all are."""
    px = canvas()
    box(px, 6, 22, SIZE - 6, SIZE - 22, ground)
    box(px, 6, 72, SIZE - 6, 92, cross)          # horizontal arm
    box(px, 52, 22, 72, SIZE - 22, cross)        # vertical arm, left of centre
    return px


def japan():
    px = canvas()
    box(px, 6, 22, SIZE - 6, SIZE - 22, (250, 250, 250))
    disc(px, SIZE / 2, SIZE / 2, 34, (206, 60, 68))
    return px


def swiss():
    px = canvas()
    box(px, 24, 24, SIZE - 24, SIZE - 24, (214, 60, 60))
    box(px, 44, 72, SIZE - 44, 92, (250, 250, 250))
    box(px, 72, 44, 92, SIZE - 44, (250, 250, 250))
    return px


FLAGS = [
    ('France', lambda: bands([(48, 82, 168), (250, 250, 250), (206, 60, 68)])),
    ('Italy', lambda: bands([(70, 160, 100), (250, 250, 250), (206, 60, 68)])),
    ('Ireland', lambda: bands([(70, 160, 100), (250, 250, 250), (240, 150, 60)])),
    ('Belgium', lambda: bands([(28, 32, 38), (246, 202, 70), (206, 60, 68)])),
    ('Germany', lambda: bands([(28, 32, 38), (206, 60, 68), (246, 202, 70)], vertical=False)),
    ('The Netherlands', lambda: bands([(206, 60, 68), (250, 250, 250), (48, 82, 168)], vertical=False)),
    ('Ukraine', lambda: bands([(60, 120, 200), (246, 202, 70)], vertical=False)),
    ('Sweden', lambda: nordic((48, 100, 176), (246, 202, 70))),
    ('Denmark', lambda: nordic((206, 60, 68), (250, 250, 250))),
    ('Finland', lambda: nordic((250, 250, 250), (48, 82, 168))),
    ('Japan', japan),
    ('Switzerland', swiss),
]


# ---- counting: n things on the front, the numeral on the back ----

COUNT_COLOURS = [(255, 176, 84), (108, 176, 232), (226, 120, 168), (120, 196, 132),
                 (238, 132, 118), (176, 148, 232), (240, 208, 96), (128, 200, 204)]


def dots(n, shape):
    """n shapes laid out in a tidy grid, so they can be counted without being scanned."""
    px = canvas()
    cols = 1 if n == 1 else (2 if n <= 4 else (3 if n <= 6 else 4))
    rows = -(-n // cols)
    cw, ch = SIZE / cols, SIZE / rows
    r = min(cw, ch) * 0.3
    for i in range(n):
        cx = cw * (i % cols) + cw / 2
        cy = ch * (i // cols) + ch / 2
        col = COUNT_COLOURS[i % len(COUNT_COLOURS)]
        if shape == 'disc':
            disc(px, cx, cy, r, col)
        elif shape == 'box':
            box(px, int(cx - r), int(cy - r), int(cx + r), int(cy + r), col)
        else:
            polygon(px, [(cx, cy - r), (cx + r, cy + r), (cx - r, cy + r)], col)
    return px


DRAWINGS = [
    ('What is this?', 'sun', sun),
    ('What is this?', 'moon', moon),
    ('What is this?', 'star', star),
    ('What is this?', 'tree', tree),
    ('What is this?', 'house', house),
    ('What is this?', 'fish', fish),
    ('What is this?', 'egg', egg),
    ('What is this?', 'ball', ball),
    ('What is this?', 'leaf', leaf),
    ('What is this?', 'cloud', cloud),
    ('What is this?', 'apple', apple),
    ('What is this?', 'boat', boat),
    ('What is this?', 'car', car),
    ('What is this?', 'cup', cup),
    ('What is this?', 'flower', flower),
    ('What is this?', 'key', key),
]

def stroke(px, x0, y0, x1, y1, w, col):
    steps = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
    for i in range(steps + 1):
        t = i / steps
        disc(px, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, w, col)


def clock(hour, minute=0):
    """A clock face reading `hour`:`minute` — on the hour, half past, or a quarter."""
    px = canvas()
    c = SIZE // 2
    disc(px, c, c, 74, (40, 44, 52))            # rim
    disc(px, c, c, 66, (235, 235, 230))         # face
    for h in range(12):                          # ticks, the quarter-hours a little bigger
        a = math.radians(h * 30 - 90)
        disc(px, c + 58 * math.cos(a), c + 58 * math.sin(a), 4 if h % 3 == 0 else 3, (40, 44, 52))
    # The hour hand creeps round with the minutes, the way a real clock's does — at half
    # past it sits between two numbers, at quarter to it is nearly on the next one.
    ha = math.radians((hour % 12) * 30 + minute / 2 - 90)
    stroke(px, c, c, c + 34 * math.cos(ha), c + 34 * math.sin(ha), 5, (40, 44, 52))
    ma = math.radians(minute * 6 - 90)
    stroke(px, c, c, c + 52 * math.cos(ma), c + 52 * math.sin(ma), 3, (200, 60, 50))
    disc(px, c, c, 6, (40, 44, 52))
    return px


def say_time(hour, minute):
    nxt = hour % 12 + 1
    return {0: f"{hour} o'clock", 15: f'quarter past {hour}', 30: f'half past {hour}',
            45: f'quarter to {nxt}'}[minute]


def write(root, name, module):
    path = os.path.join(root, 'modules', name)
    io.open(path, 'w', encoding='utf-8', newline='\n').write(json.dumps(module, indent=2, ensure_ascii=False) + '\n')
    print(f'{path}  {len(module["cards"])} cards  {os.path.getsize(path) // 1024} KB')


if __name__ == '__main__':
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    cards = [{'id': word, 'front': front, 'back': word, 'image': png(draw())}
             for front, word, draw in DRAWINGS]
    module = {
        'id': 'picture-words',
        'title': 'Picture Words',
        'description': 'A picture, and a word to spell. No reading needed.',
        'icon': '🖼️',
        'tags': ['words', 'kids'],
        'cards': cards,
    }
    path = os.path.join(root, 'modules', 'picture-words.json')
    io.open(path, 'w', encoding='utf-8', newline='\n').write(json.dumps(module, indent=2, ensure_ascii=False) + '\n')
    print(f'{path}  {len(cards)} cards  {os.path.getsize(path) // 1024} KB')

    # Counting: the answers are numerals, so the number pad game works on it straight away.
    shapes = ['disc', 'box', 'tri']
    counts = [{'id': f'n{n}', 'front': 'How many?', 'back': str(n),
               'image': png(dots(n, shapes[(n - 1) % 3]))} for n in range(1, 11)]
    counting = {
        'id': 'counting',
        'title': 'Counting',
        'description': 'How many things are there? Tap the number.',
        'icon': '🔢',
        'tags': ['maths', 'kids'],
        'cards': counts,
    }
    colours = [{'id': name, 'front': 'What colour is this?', 'back': name, 'image': png(patch(col))}
               for name, col in COLOURS]
    write(root, 'colours.json', {
        'id': 'colours', 'title': 'Colours', 'description': 'A patch of colour, and its name.',
        'icon': '🎨', 'tags': ['words', 'kids'], 'cards': colours,
    })

    shapes = [{'id': name, 'front': 'What shape is this?', 'back': name, 'image': png(draw())}
              for name, draw in SHAPES]
    write(root, 'shapes.json', {
        'id': 'shapes', 'title': 'Shapes', 'description': 'One shape, one word.',
        'icon': '◇', 'tags': ['words', 'kids'], 'cards': shapes,
    })

    flags = [{'id': name.lower().replace(' ', '-'), 'front': 'Whose flag is this?', 'back': name,
              'image': png(draw())} for name, draw in FLAGS]
    write(root, 'flags.json', {
        'id': 'flags', 'title': 'Flags', 'description': 'Twelve flags, drawn plainly. Whose is it?',
        'icon': '🚩', 'tags': ['geography', 'kids'], 'cards': flags,
    })

    times = ([(h, 0) for h in (1, 2, 3, 5, 6, 7, 8, 9, 10, 12)]
             + [(h, 30) for h in (1, 3, 4, 6, 9, 11)]
             + [(h, 15) for h in (2, 5, 8, 11)]
             + [(h, 45) for h in (2, 5, 8, 11)])      # said as "quarter to" the next hour
    suffix = {0: '', 15: 'q', 30: 'h', 45: 't'}
    clocks = [{'id': f't{h}{suffix[m]}', 'front': 'What time is it?',
               'back': say_time(h, m), 'image': png(clock(h, m))} for h, m in times]
    write(root, 'telling-time.json', {
        'id': 'telling-time', 'title': 'Telling the Time',
        'description': 'A clock face, read aloud: on the hour, half past, quarter past and quarter to.',
        'icon': '🕒', 'tags': ['maths', 'kids'], 'cards': clocks,
    })

    path = os.path.join(root, 'modules', 'counting.json')
    io.open(path, 'w', encoding='utf-8', newline='\n').write(json.dumps(counting, indent=2, ensure_ascii=False) + '\n')
    print(f'{path}  {len(counts)} cards  {os.path.getsize(path) // 1024} KB')
