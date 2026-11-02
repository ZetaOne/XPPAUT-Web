"""Compare two screenshots; write reference | ours | differences (red).

  python3 scripts/compare-images.py ref.png web.png out.png
Prints "identical" or a summary of the difference.
"""
import sys

from PIL import Image, ImageChops

try:
    ref = Image.open(sys.argv[1]).convert("RGB")
    web = Image.open(sys.argv[2]).convert("RGB")
except FileNotFoundError as e:
    print("missing " + e.filename)
    sys.exit(0)
note = "" if ref.size == web.size else " (sizes %s vs %s)" % (ref.size, web.size)
w, h = max(ref.width, web.width), max(ref.height, web.height)


def pad(im):
    out = Image.new("RGB", (w, h), (255, 0, 255))
    out.paste(im, (0, 0))
    return out


ref, web = pad(ref), pad(web)
diff = ImageChops.difference(ref, web)
mask = diff.convert("L").point(lambda v: 255 if v else 0)
n = sum(1 for v in mask.getdata() if v)
out = Image.new("RGB", (w * 3 + 20, h), "white")
out.paste(ref, (0, 0))
out.paste(web, (w + 10, 0))
base = ref.convert("L").convert("RGB").point(lambda v: 128 + v // 2)
base.paste(Image.new("RGB", (w, h), (255, 0, 0)), (0, 0), mask)
out.paste(base, (2 * w + 20, 0))
out.save(sys.argv[3])
if n == 0 and not note:
    print("identical")
else:
    print("%d pixels differ (%.2f%%), bbox %s%s" % (n, 100.0 * n / (w * h), diff.getbbox(), note))
