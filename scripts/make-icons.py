#!/usr/bin/env python3
"""Draws the Agent Watch robot once and writes it everywhere it appears:

  media/agent-watch.woff     the status bar glyph: product icon "agent-watch-robot", U+E000
                              (the chip's live dots follow it, so it has none of its own), and the
                              usage rings "agent-watch-usage-zero" to "-hundred", U+E001 to U+E065,
                              and "agent-watch-usage-unknown", U+E066
  media/activity.svg          the activity bar icon: the robot with three dots under its head,
                              in one color, as VS Code paints activity bar icons
  media/icon.svg, icon.png    the extension icon: the same, with the dots in their status colors
                              and no background
  package.json                the usage rings' entries in contributes.icons

Run with `python3 scripts/make-icons.py` after changing the drawing. Needs fontTools
(pip install fonttools) and Google Chrome or Chromium for the PNG.
"""

import json
import math
import os
import shutil
import subprocess
import tempfile

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen

MEDIA = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'media')
K = 0.5522847498  # Cubic control distance for a quarter circle, per unit of radius.

# Status colors, as in the chip's dots: working, waiting, idle.
DOT_COLORS = ['#FBC02D', '#F44336', '#4CAF50']
# Two tones keep the transparent extension icon readable on light and dark pages: a light face
# inside a mid blue-grey outline.
FACE = '#ECEFF1'
OUTLINE = '#607D8B'
EYES = '#37474F'


# Contours are drawn on a 24x24 grid, y pointing down. Filled shapes go clockwise on screen and
# holes counter-clockwise, which is what TrueType expects and what SVG's nonzero rule fills.

def rounded_rect(x0, y0, x1, y1, r, clockwise=True):
    k = K * r
    segments = [
        ('M', (x0 + r, y0)),
        ('L', (x1 - r, y0)), ('C', (x1 - r + k, y0), (x1, y0 + r - k), (x1, y0 + r)),
        ('L', (x1, y1 - r)), ('C', (x1, y1 - r + k), (x1 - r + k, y1), (x1 - r, y1)),
        ('L', (x0 + r, y1)), ('C', (x0 + r - k, y1), (x0, y1 - r + k), (x0, y1 - r)),
        ('L', (x0, y0 + r)), ('C', (x0, y0 + r - k), (x0 + r - k, y0), (x0 + r, y0)),
    ]
    return segments if clockwise else reverse(segments)


def circle(cx, cy, r, clockwise=True):
    k = K * r
    segments = [
        ('M', (cx, cy - r)),
        ('C', (cx + k, cy - r), (cx + r, cy - k), (cx + r, cy)),
        ('C', (cx + r, cy + k), (cx + k, cy + r), (cx, cy + r)),
        ('C', (cx - k, cy + r), (cx - r, cy + k), (cx - r, cy)),
        ('C', (cx - r, cy - k), (cx - k, cy - r), (cx, cy - r)),
    ]
    return segments if clockwise else reverse(segments)


def reverse(segments):
    pieces, current = [], segments[0][1]
    for segment in segments[1:]:
        pieces.append((current, segment))
        current = segment[-1]
    reversed_segments = [('M', current)]
    for start, segment in reversed(pieces):
        if segment[0] == 'L':
            reversed_segments.append(('L', start))
        else:
            reversed_segments.append(('C', segment[2], segment[1], start))
    return reversed_segments


def outline():
    return [
        rounded_rect(3.2, 8.4, 20.8, 21.0, 3.4),  # head
        rounded_rect(4.8, 10.0, 19.2, 19.4, 1.8, clockwise=False),  # inside the head
        rounded_rect(11.2, 5.4, 12.8, 8.8, 0.3),  # antenna
        circle(12, 4.2, 1.7),
        rounded_rect(1.0, 12.6, 2.6, 16.8, 0.8),  # ears
        rounded_rect(21.4, 12.6, 23.0, 16.8, 0.8),
    ]


def face():
    return [rounded_rect(4.8, 10.0, 19.2, 19.4, 1.8)]


def eyes():
    return [circle(8.8, 14.7, 1.6), circle(15.2, 14.7, 1.6)]


def robot():
    return outline() + eyes()


# The three status dots under the head, in grid units: centers and radius.
DOT_XS = (6.0, 12.0, 18.0)
DOT_R = 1.9


def dots(cy):
    return [circle(x, cy, DOT_R) for x in DOT_XS]


# The usage rings: like a progress spinner, a thin circle that a thick arc fills clockwise from
# 12 o'clock with how much of a usage limit is used, one glyph per percent, with that percent written
# inside. A used-up limit is a full ring around an exclamation mark: "100" does not fit. An empty ring
# around a question mark is a limit whose use is unknown, because its window started over since the
# reading.
USAGE_LEVELS = range(0, 101)
USAGE_UNKNOWN = 0xE001 + len(USAGE_LEVELS)
RING_R = 10.85  # Radius of the middle of the arc.
RING_ARC = 1.05  # Half the arc's thickness.
RING_TRACK = 0.35  # Half the thickness of the circle it fills.

# The digits inside: strokes along the segments of a seven-segment display, joined at the corners so
# they read as a plain geometric face. Each is drawn in a box of DIGIT_W by DIGIT_H grid units.
DIGIT_W = 5.6
DIGIT_H = 11.5
DIGIT_STROKE = 1.75
DIGIT_GAP = 1.0
SEGMENTS = {  # a top, b top right, c bottom right, d bottom, e bottom left, f top left, g middle
    '0': 'abcdef', '1': 'bc', '2': 'abdeg', '3': 'abcdg', '4': 'bcfg',
    '5': 'acdfg', '6': 'acdefg', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg',
}


def digit(char, x0, y0):
    s, r = DIGIT_STROKE, DIGIT_STROKE / 2
    x1, y1 = x0 + DIGIT_W, y0 + DIGIT_H
    ym = (y0 + y1) / 2
    if char == '1':  # A single upright, centered in its box.
        x = (x0 + x1 - s) / 2
        return [rounded_rect(x, y0, x + s, y1, r)]
    bars = {
        'a': (x0, y0, x1, y0 + s),
        'b': (x1 - s, y0, x1, ym + r),
        'c': (x1 - s, ym - r, x1, y1),
        'd': (x0, y1 - s, x1, y1),
        'e': (x0, ym - r, x0 + s, y1),
        'f': (x0, y0, x0 + s, ym + r),
        'g': (x0, ym - r, x1, ym + r),
    }
    return [rounded_rect(*bars[segment], r) for segment in SEGMENTS[char]]


def number(text):
    width = len(text) * DIGIT_W + (len(text) - 1) * DIGIT_GAP
    x0, y0 = 12 - width / 2, 12 - DIGIT_H / 2
    return [contour for i, char in enumerate(text) for contour in digit(char, x0 + i * (DIGIT_W + DIGIT_GAP), y0)]


def exclamation():
    s, r = DIGIT_STROKE, DIGIT_STROKE / 2
    x0, y0 = 12 - r, 12 - DIGIT_H / 2
    return [rounded_rect(x0, y0, x0 + s, y0 + DIGIT_H - s - 1.4, r), circle(12, y0 + DIGIT_H - r, r)]


def question():
    s, r = DIGIT_STROKE, DIGIT_STROKE / 2
    x0, y0 = 12 - DIGIT_W / 2, 12 - DIGIT_H / 2
    x1, y1, ym = x0 + DIGIT_W, y0 + DIGIT_H, 12 - 0.6
    return [
        rounded_rect(x0, y0, x1, y0 + s, r),  # The hook: over the top, down the right, back to the middle.
        rounded_rect(x1 - s, y0, x1, ym + r, r),
        rounded_rect(12 - r, ym - r, x1, ym + r, r),
        rounded_rect(12 - r, ym - r, 12 + r, y1 - s - 1.4, r),  # The stem, under the middle.
        circle(12, y1 - r, r),
    ]


def usage_name(level):
    """The level spelled out, as in the icon's name: hovers drop icons whose names have digits."""
    ones = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven',
            'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
    tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
    if level == 100:
        return 'hundred'
    if level < 20:
        return ones[level]
    return tens[level // 10] + (f'-{ones[level % 10]}' if level % 10 else '')


def arc(cx, cy, r, start, end):
    """Cubic segments along a circle from angle start to end, in degrees clockwise from 12 o'clock
    (counter-clockwise when end < start), without the move to the first point."""
    def point(a):
        return (cx + r * math.sin(a), cy - r * math.cos(a))

    count = max(1, math.ceil(abs(end - start) / 90))
    step = math.radians(end - start) / count
    k = 4 / 3 * math.tan(step / 4) * r
    segments = []
    for i in range(count):
        a0 = math.radians(start) + i * step
        a1 = a0 + step
        p0, p1 = point(a0), point(a1)
        segments.append((
            'C',
            (p0[0] + k * math.cos(a0), p0[1] + k * math.sin(a0)),
            (p1[0] - k * math.cos(a1), p1[1] - k * math.sin(a1)),
            p1,
        ))
    return segments


def ring(level):
    if level is None:
        return [circle(12, 12, RING_R + RING_TRACK), circle(12, 12, RING_R - RING_TRACK, clockwise=False)] + question()
    if level == 100:
        return [circle(12, 12, RING_R + RING_ARC), circle(12, 12, RING_R - RING_ARC, clockwise=False)] + exclamation()
    contours = [circle(12, 12, RING_R + RING_TRACK), circle(12, 12, RING_R - RING_TRACK, clockwise=False)]
    if level:
        end = 360 * level / 100
        outer, inner = RING_R + RING_ARC, RING_R - RING_ARC
        cap_end = (12 + RING_R * math.sin(math.radians(end)), 12 - RING_R * math.cos(math.radians(end)))
        contours.append(
            [('M', (12, 12 - outer))]
            + arc(12, 12, outer, 0, end)
            + arc(*cap_end, RING_ARC, end, end + 180)  # Round end, ahead of the arc.
            + arc(12, 12, inner, end, 0)
            + arc(12, 12 - RING_R, RING_ARC, 180, 360)  # Round start, behind 12 o'clock.
        )
    return contours + number(str(level))


def transform(contours, scale, dx, dy):
    """Scales and moves contours drawn on the grid."""
    def point(p):
        return (p[0] * scale + dx, p[1] * scale + dy)

    return [[(segment[0], *[point(p) for p in segment[1:]]) for segment in segments] for segments in contours]


def path_data(contours, scale=1.0, dx=0.0, dy=0.0):
    def point(p):
        return f'{p[0] * scale + dx:.3f} {p[1] * scale + dy:.3f}'

    parts = []
    for segments in contours:
        for segment in segments:
            if segment[0] == 'M':
                parts.append(f'M{point(segment[1])}')
            elif segment[0] == 'L':
                parts.append(f'L{point(segment[1])}')
            else:
                parts.append(f'C{point(segment[1])} {point(segment[2])} {point(segment[3])}')
        parts.append('Z')
    return ''.join(parts)


def glyph(contours, unit, upm):
    tt = TTGlyphPen(None)
    # Flip y (fonts point up) and turn the cubic curves into TrueType's quadratic ones.
    pen = TransformPen(Cu2QuPen(tt, max_err=0.5), (unit, 0, 0, -unit, 0, upm))
    for segments in contours:
        for segment in segments:
            if segment[0] == 'M':
                pen.moveTo(segment[1])
            elif segment[0] == 'L':
                pen.lineTo(segment[1])
            else:
                pen.curveTo(segment[1], segment[2], segment[3])
        pen.closePath()
    return tt.glyph()


def write_font(path):
    unit = 50
    upm = 24 * unit
    glyphs = {'robot': (0xE000, robot())}
    for i, level in enumerate(USAGE_LEVELS):
        glyphs[f'usage-{usage_name(level)}'] = (0xE001 + i, ring(level))
    glyphs['usage-unknown'] = (USAGE_UNKNOWN, ring(None))

    builder = FontBuilder(upm, isTTF=True)
    builder.setupGlyphOrder(['.notdef', *glyphs])
    builder.setupCharacterMap({code: name for name, (code, _) in glyphs.items()})
    drawn = {name: glyph(contours, unit, upm) for name, (_, contours) in glyphs.items()}
    builder.setupGlyf({'.notdef': TTGlyphPen(None).glyph(), **drawn})
    metrics = {'.notdef': (upm, 0)}
    for name in glyphs:
        built = builder.font['glyf'][name]
        built.recalcBounds(builder.font['glyf'])
        metrics[name] = (upm, built.xMin)
    builder.setupHorizontalMetrics(metrics)
    # Like VS Code's codicons: the glyph fills the em square, with no descent.
    builder.setupHorizontalHeader(ascent=upm, descent=0)
    builder.setupNameTable({'familyName': 'Agent Watch Icons', 'styleName': 'Regular'})
    builder.setupOS2(sTypoAscender=upm, sTypoDescender=0, sTypoLineGap=0, usWinAscent=upm, usWinDescent=0)
    builder.setupPost()
    builder.font.flavor = 'woff'
    builder.save(path)


def write_icons(path):
    """Contributes every usage ring as a product icon, in place of the ones package.json had."""
    with open(path) as f:
        package = json.load(f)
    icons = {k: v for k, v in package['contributes']['icons'].items() if not k.startswith('agent-watch-usage-')}

    def icon(description, code):
        return {'description': description, 'default': {'fontPath': 'media/agent-watch.woff', 'fontCharacter': f'\\{code:X}'}}

    for i, level in enumerate(USAGE_LEVELS):
        icons[f'agent-watch-usage-{usage_name(level)}'] = icon(f'A ring {level}% full, for how much of a usage limit is used', 0xE001 + i)
    icons['agent-watch-usage-unknown'] = icon('An empty ring with a question mark, for a usage limit whose use is unknown', USAGE_UNKNOWN)
    package['contributes']['icons'] = icons
    with open(path, 'w') as f:
        f.write(json.dumps(package, indent=2, ensure_ascii=False) + '\n')


def activity_svg():
    # The robot shrunk to the top of the square, with room for the dots under its head.
    scale = 0.8
    head = transform(robot(), scale, 12 * (1 - scale), -0.2)
    contours = head + dots(21.3)
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">'
        f'<path fill="#C5C5C5" d="{path_data(contours)}"/></svg>\n'
    )


def icon_svg():
    # No background: the robot and its dots fill the square, leaving a small margin.
    scale = 5.0
    dx = 64 - 12 * scale
    dy = 4.2 - 2.5 * scale  # The antenna's top (y 2.5 on the grid) starts 4 px from the top.
    cy = 21.0 * scale + dy + 8 + DOT_R * scale  # Dots 8 px under the head.
    status = ''.join(
        f'<circle cx="{64 + (x - 12) * scale:.2f}" cy="{cy:.2f}" r="{DOT_R * scale:.2f}" fill="{color}"/>'
        for x, color in zip(DOT_XS, DOT_COLORS)
    )
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">'
        f'<path fill="{FACE}" d="{path_data(face(), scale, dx, dy)}"/>'
        f'<path fill="{OUTLINE}" d="{path_data(outline(), scale, dx, dy)}"/>'
        f'<path fill="{EYES}" d="{path_data(eyes(), scale, dx, dy)}"/>'
        f'{status}</svg>\n'
    )


def find_chrome():
    for name in (os.environ.get('CHROME'), 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'):
        if name and shutil.which(name):
            return shutil.which(name)
    raise SystemExit('Google Chrome or Chromium not found; set CHROME.')


def write_png(svg, path, size=128):
    work = tempfile.mkdtemp(prefix='agent-watch-icon-')
    try:
        html = os.path.join(work, 'icon.html')
        with open(html, 'w') as f:
            f.write(f'<!doctype html><html><body style="margin:0;background:transparent">{svg}</body></html>')
        subprocess.run(
            [
                find_chrome(), '--headless=new', '--disable-gpu', '--hide-scrollbars',
                f'--user-data-dir={os.path.join(work, "profile")}', '--default-background-color=00000000',
                f'--window-size={size},{size}', f'--screenshot={path}', f'file://{html}',
            ],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    finally:
        shutil.rmtree(work, ignore_errors=True)


def main():
    write_font(os.path.join(MEDIA, 'agent-watch.woff'))
    with open(os.path.join(MEDIA, 'activity.svg'), 'w') as f:
        f.write(activity_svg())
    svg = icon_svg()
    with open(os.path.join(MEDIA, 'icon.svg'), 'w') as f:
        f.write(svg)
    write_png(svg, os.path.join(MEDIA, 'icon.png'))
    write_icons(os.path.join(MEDIA, '..', 'package.json'))
    for name in ('media/agent-watch.woff', 'media/activity.svg', 'media/icon.svg', 'media/icon.png', 'package.json'):
        print(f'Wrote {name}')


if __name__ == '__main__':
    main()
