"""Run a GUI test script against the real desktop XPPAUT on Xvfb.

Reads the same script language as web/xlib/platform_native.c and performs it
with xdotool, saving window shots with xwd, so the two can be compared
pixel by pixel (see scripts/compare-gui.sh).

  python3 scripts/xref.py <xppaut binary> <file.ode> <script> <outdir>

Differences from the headless harness: there is no "idle" signal, so the
driver sleeps after each command (`sleep MS` adds more); there is no window
manager, so a window is raised before it is clicked or shot.
"""
import os
import subprocess
import sys
import time

from PIL import Image

xpp, ode, script, outdir = sys.argv[1:5]
DISPLAY = ":%d" % (90 + os.getpid() % 9)
STEP = 0.35  # seconds after each command

env = dict(os.environ, DISPLAY=DISPLAY)


def run(*args, check=True):
    return subprocess.run(args, env=env, check=check, capture_output=True, text=True).stdout


xvfb = subprocess.Popen(["Xvfb", DISPLAY, "-screen", "0", "1280x1024x24", "-nolisten", "tcp"],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(0.8)
app = subprocess.Popen([os.path.abspath(xpp), os.path.basename(ode)], cwd=outdir, env=env,
                       stdout=open(os.path.join(outdir, "ref-xpp.log"), "w"), stderr=subprocess.STDOUT)
time.sleep(1.5)

cur = None  # current window id


def geometry(win):
    info = run("xwininfo", "-id", win)
    g = {}
    for line in info.splitlines():
        line = line.strip()
        for key, name in (("Absolute upper-left X:", "x"), ("Absolute upper-left Y:", "y"),
                          ("Width:", "w"), ("Height:", "h"), ("Border width:", "bw")):
            if line.startswith(key):
                g[name] = int(line.split(":")[1])
    return g


def find(prefix):
    ids = run("xdotool", "search", "--onlyvisible", "--name", ".", check=False).split()
    if prefix == "*":  # newest viewable window other than the first (main) one
        ids = sorted(ids, key=int)
        live = [i for i in ids if "IsViewable" in run("xwininfo", "-id", i, check=False)]
        if len(live) < 2:
            sys.exit("xref: no second window")
        return live[-1]
    for line in run("xdotool", "search", "--onlyvisible", "--name", ".", check=False).split():
        name = run("xdotool", "getwindowname", line, check=False).strip()
        if name.startswith(prefix):
            return line
    sys.exit("xref: no window titled %r" % prefix)


def to_root(x, y):
    if cur is None:
        return x, y
    g = geometry(cur)  # outer corner; without a WM the X border surrounds the contents
    return g["x"] + g["bw"] + x, g["y"] + g["bw"] + y


KEYS = {" ": "space", "-": "minus", ".": "period", "+": "plus", "=": "equal", ",": "comma",
        "/": "slash", "*": "asterisk", "(": "parenleft", ")": "parenright"}

try:
    for raw in open(script):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        cmd, _, rest = line.partition(" ")
        rest = rest.strip()
        if cmd == "window":
            name = rest.strip('"')
            cur = None if name == "root" else find(name)
            if cur:
                run("xdotool", "windowraise", cur)
        elif cmd in ("move", "click", "press", "release"):
            a = rest.split()
            x, y = to_root(int(a[0]), int(a[1]))
            b = a[2] if len(a) > 2 else "1"
            if cur:
                run("xdotool", "windowraise", cur)
            run("xdotool", "mousemove", str(x), str(y))
            if cmd == "click":
                run("xdotool", "click", b)
            elif cmd == "press":
                run("xdotool", "mousedown", b)
            elif cmd == "release":
                run("xdotool", "mouseup", b)
        elif cmd == "key":
            k = rest.replace("ctrl+", "ctrl+").replace("shift+", "shift+")
            run("xdotool", "key", KEYS.get(k, k))
        elif cmd == "type":
            for c in rest:
                run("xdotool", "key", KEYS.get(c, c))
        elif cmd == "sleep":
            time.sleep(int(rest) / 1000)
        elif cmd == "close":
            run("xdotool", "windowclose", cur, check=False)
        elif cmd in ("shot", "screenshot"):
            time.sleep(STEP)
            target = cur if cmd == "shot" else "root"
            xwd = os.path.join(outdir, "tmp.xwd")
            run("xwd", "-silent", "-id" if target != "root" else "-root", *([target] if target != "root" else []),
                "-out", xwd)
            png = os.path.join(outdir, "ref-" + os.path.basename(rest).rsplit(".", 1)[0] + ".png")
            run("convert", xwd, png)
            if target != "root":  # xwd includes the X border; the WM-less web build has none
                bw = geometry(cur)["bw"]
                im = Image.open(png)
                im.crop((bw, bw, im.width - bw, im.height - bw)).save(png)
            os.remove(xwd)
        elif cmd == "list":
            for wid in run("xdotool", "search", "--onlyvisible", "--name", ".", check=False).split():
                print("  ref window", wid, repr(run("xdotool", "getwindowname", wid, check=False).strip()))
        elif cmd in ("probe", "quit"):
            pass
        else:
            sys.exit("xref: unknown command " + cmd)
        time.sleep(STEP)
finally:
    app.kill()
    xvfb.kill()
