#!/usr/bin/env python3
"""The editor's icon (public/editor-icon.svg): a neon "xW" on a spider web,
unlike XPP's cockatoo so the two tabs are told apart at a glance.
PNGs: inkscape public/editor-icon.svg -o public/editor-icon-192.png -w 192 (also 180, 32, 16)."""
import math
def web(cx, cy, r, n=8, rings=4, a0=-90, span=360, sag=0.18, col='#0ff', w=2.2, op=1):
    """spider web: n spokes, rings of sagging threads (curved inward)"""
    out=[]
    full = span>=360
    angs=[a0+span*i/(n if full else n-1) for i in range(n)]
    for a in angs:
        t=math.radians(a); out.append(f'<line x1="{cx}" y1="{cy}" x2="{cx+r*math.cos(t):.1f}" y2="{cy+r*math.sin(t):.1f}"/>')
    for k in range(1,rings+1):
        rr=r*k/rings; d=''
        pts=[(cx+rr*math.cos(math.radians(a)), cy+rr*math.sin(math.radians(a))) for a in angs]
        if full: pts.append(pts[0])
        d=f'M{pts[0][0]:.1f},{pts[0][1]:.1f}'
        for (x0,y0),(x1,y1) in zip(pts,pts[1:]):
            mx,my=(x0+x1)/2,(y0+y1)/2
            qx,qy=mx+(cx-mx)*sag, my+(cy-my)*sag
            d+=f' Q{qx:.1f},{qy:.1f} {x1:.1f},{y1:.1f}'
        out.append(f'<path d="{d}"/>')
    return f'<g fill="none" stroke="{col}" stroke-width="{w}" stroke-linecap="round" opacity="{op}">'+''.join(out)+'</g>'

def glow(id_, std):
    return f'<filter id="{id_}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="{std}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'

def xw(x, y, s, col, w):
    x=(256-(s*0.55+s*1.06))/2 if x is None else x
    # neon-tube letters: small x, capital W (s = W height)
    xs=s*0.55; xy=y+s-xs
    W=f'M{x+xs+s*0.18:.1f},{y:.1f} L{x+xs+s*0.40:.1f},{y+s:.1f} L{x+xs+s*0.62:.1f},{y+s*0.38:.1f} L{x+xs+s*0.84:.1f},{y+s:.1f} L{x+xs+s*1.06:.1f},{y:.1f}'
    X=f'M{x:.1f},{xy:.1f} L{x+xs:.1f},{y+s:.1f} M{x+xs:.1f},{xy:.1f} L{x:.1f},{y+s:.1f}'
    return f'<path d="{X} {W}" fill="none" stroke="{col}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"/>'

def svg(body, bg='#0b0b14', rx=48):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256"><defs>{glow("g",5)}{glow("g2",3)}</defs><rect width="256" height="256" rx="{rx}" fill="{bg}"/>{body}</svg>'


small = svg(f'<g filter="url(#g2)">{web(128,128,118,n=8,rings=3,col="#ff2bd6",w=7,op=.85)}</g><g filter="url(#g)">{xw(None,80,96,"#39ff14",22)}</g>')
big = svg(f'<g filter="url(#g2)">{web(128,128,118,n=10,rings=5,col="#ff2bd6",w=2.5,op=.75)}</g><g filter="url(#g)">{xw(None,80,96,"#39ff14",16)}</g>')
open('public/editor-icon.svg','w').write(big)
open('public/editor-icon-small.svg','w').write(small)  # 16/32 px: fewer, thicker threads (render, then delete)
