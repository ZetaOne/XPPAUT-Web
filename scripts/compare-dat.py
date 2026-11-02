"""Compare two XPPAUT output.dat files numerically.

Prints CLOSE if they have the same shape and every value agrees within a
relative tolerance of 1e-6 (or absolute 1e-9 near zero), otherwise DIFF with
the first mismatch. Used for builds whose math library may differ from glibc
in the last bits (e.g. WebAssembly with musl).
"""
import math
import sys

REL, ABS = 1e-6, 1e-9


def rows(path):
    with open(path) as f:
        return [line.split() for line in f if line.strip()]


a, b = rows(sys.argv[1]), rows(sys.argv[2])
if len(a) != len(b):
    print(f"DIFF (rows {len(a)} vs {len(b)})")
    sys.exit(0)
worst = 0.0
for i, (ra, rb) in enumerate(zip(a, b)):
    if len(ra) != len(rb):
        print(f"DIFF (row {i + 1}: {len(ra)} vs {len(rb)} columns)")
        sys.exit(0)
    for j, (x, y) in enumerate(zip(ra, rb)):
        try:
            fx, fy = float(x), float(y)
        except ValueError:
            if x != y:
                print(f"DIFF (row {i + 1} col {j + 1}: {x} vs {y})")
                sys.exit(0)
            continue
        if math.isnan(fx) and math.isnan(fy):
            continue
        if not math.isclose(fx, fy, rel_tol=REL, abs_tol=ABS):
            print(f"DIFF (row {i + 1} col {j + 1}: {x} vs {y})")
            sys.exit(0)
        worst = max(worst, abs(fx - fy) / max(abs(fx), abs(fy), ABS))
print(f"CLOSE (max rel err {worst:.1e})")
