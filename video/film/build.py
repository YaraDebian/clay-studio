# Writes compositions/studio.html: one continuous camera take across the captured studio stills.
import json

W, H = 1920, 1080

def clamp_cam(cx, cy, s):
    hw, hh = W / 2 / s, H / 2 / s
    return min(max(cx, hw), W - hw), min(max(cy, hh), H - hh), s

def cam_xy(cx, cy, s):
    cx, cy, s = clamp_cam(cx, cy, s)
    return round(W / 2 - cx * s, 1), round(H / 2 - cy * s, 1), s

def screen(p, cam):
    cx, cy, s = clamp_cam(*cam)
    return round((p[0] - cx) * s + W / 2), round((p[1] - cy) * s + H / 2)

# points of interest in the 1920x1080 image space
P = dict(window=(1410, 150), pin=(975, 983), marta=(593, 245), slabs=(690, 558), retake=(362, 690),
         rack=(1350, 300), book=(1163, 790), sponge=(1425, 690), jar=(1628, 705), sign=(660, 118))

# camera keys: (time, cx, cy, scale, duration, ease)
CAMS = [
    (0.0, 1400, 300, 1.9, 0, None),
    (2.8, 975, 900, 1.6, 1.2, "power2.inOut"),
    (4.6, 960, 540, 1.0, 1.8, "power2.inOut"),
    (11.0, 640, 300, 2.1, 1.1, "power2.inOut"),
    (15.8, 700, 520, 2.3, 1.1, "power2.inOut"),
    (19.2, 520, 700, 2.0, 1.1, "power2.inOut"),
    (24.6, 1330, 300, 1.75, 1.2, "power2.inOut"),
    (29.0, 1163, 800, 2.0, 1.1, "power2.inOut"),
    (32.6, 1425, 700, 2.4, 1.1, "power2.inOut"),
    (37.2, 960, 540, 1.0, 1.6, "power2.inOut"),
    (41.0, 820, 360, 1.6, 2.0, "power2.inOut"),
]
def cam_at(t):
    cur = CAMS[0]
    for c in CAMS:
        if c[0] + c[4] <= t + 1e-6: cur = c
    return cur[1:4]

LAYERS = [  # id, file, start, end
    ("l-dawn", "01-dawn-empty", 0, 6.0),
    ("l-dawnfull", "02-dawn-full", 4.2, 7.4),
    ("l-morning", "03-morning-full", 5.6, 15.0),
    ("l-done", "04-morning-note-done", 14.3, 38.6),
    ("l-noon", "05-noon", 37.6, 39.2),
    ("l-golden", "06-golden", 38.4, 41.8),
    ("l-dusk", "07-dusk", 40.9, 46.0),
]

CAPTIONS = [  # id, start, end, words, accent word index or None
    ("c1", 0.4, 2.7, "08:58 · the studio wakes up", None),
    ("c2", 5.2, 7.6, "Roll the pin, your day appears", 4),
    ("c3", 8.0, 10.8, "A cheeky studio spirit plans your morning", 3),
    ("c4", 11.3, 13.85, "Slack asks pin themselves to the board", 0),
    ("c5", 13.9, 15.95, "Done leaves a ✅ in Slack", None),
    ("c6", 16.4, 19.0, "Today's meetings, as clay slabs", 4),
    ("c7", 19.55, 21.9, "Claude sessions nap on the mat", 4),
    ("c8", 22.0, 24.5, "Poke one, it opens in cmux", 0),
    ("c9", 25.1, 27.5, "Merged PRs dry on the rack", 3),
    ("c10", 27.6, 29.1, "until market day", 1),
    ("c11", 29.6, 32.4, "Ideas wait in the sketchbook", 0),
    ("c12", 33.0, 37.0, "One squeeze frees 6 GB", 1),
    ("c13", 38.2, 40.6, "Finished pieces drop in the jar", 3),
]

UI = [  # id, file, start, end, centre x, centre y, width
    ("u-plan", "ui-plan", 7.6, 11.0, 520, 470, 728),
    ("u-slack", "ui-inspect-slack", 12.7, 14.2, 1330, 520, 760),
    ("u-session", "ui-inspect-session", 20.9, 24.4, 1330, 460, 680),
    ("u-sponge", "ui-sponge", 33.5, 35.6, 760, 320, 860),
]

# cursor path: (time, target screen x, y, click?)
def at(name, t): return screen(P[name], cam_at(t))
CURSOR = [
    (3.3, 2050, 1150, False),
    (4.0, *at("pin", 4.0), True),
    (5.0, 1500, 1200, False),
    (11.9, *at("marta", 12.0), False), (12.6, *at("marta", 12.6), True),
    (13.6, 1145, 680, True),     # Done button on the Slack panel
    (15.2, 1900, 1150, False),
    (20.2, *at("retake", 20.4), False), (20.8, *at("retake", 20.8), True),
    (22.4, 1138, 658, True),   # Open in cmux
    (24.0, 2000, 1100, False),
    (33.0, *at("sponge", 33.0), False), (33.4, *at("sponge", 33.4), True),
    (35.0, 992, 691, True),        # Wipe button on the sponge panel
    (36.2, 2050, 1150, False),
]

def words_html(cid, text, accent):
    out = []
    for i, w in enumerate(text.split(" ")):
        cls = "w acc" if accent == i else "w"
        out.append(f'<span class="{cls}" id="{cid}-w{i}">{w}</span>')
    return " ".join(out)

html = []
html.append('''<template>
  <style>
    @font-face { font-family: "Patrick Hand"; src: url("assets/fonts/patrick.woff2") format("woff2"); }
    @font-face { font-family: "Fredoka"; font-weight: 600; src: url("assets/fonts/fredoka.woff2") format("woff2"); }
    #plaque { position: absolute; left: 510px; top: 330px; width: 900px; height: 230px; }
    #plaque-in { width: 900px; height: 230px; border-radius: 34px 40px 36px 30px; background: #FBD0DC; border: 5px solid #E9A9BC;
      box-shadow: 0 14px 0 #E3A0B4, 0 30px 60px rgba(40,20,40,.35); display: flex; align-items: center; justify-content: center;
      font: 600 150px/1 "Fredoka", sans-serif; color: #8E4A6B; letter-spacing: -2px; transform-origin: 50% 50%; position: relative; }
    #plaque-in i { position: absolute; width: 26px; height: 26px; border-radius: 50%; background: #FAD47A; box-shadow: inset -4px -5px 0 #E3B653; top: 26px; }
    #plaque-in i.l { left: 34px; } #plaque-in i.r { right: 34px; }
    #root { position: absolute; inset: 0; overflow: hidden; background: #F3E2C4; }
    #cam { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; transform-origin: 0 0; }
    .layer { position: absolute; inset: 0; }
    .layer img { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; display: block; }
    .cap { position: absolute; left: 230px; bottom: 150px; }
    .cap .tape { display: inline-block; padding: 14px 34px 18px; background: rgba(251,233,168,.94); color: #4A2C3D;
      font: 400 58px/1.05 "Patrick Hand", cursive; transform: rotate(-1.5deg); box-shadow: 0 6px 18px rgba(74,44,61,.18);
      border-left: 3px dashed rgba(217,169,78,.55); border-right: 3px dashed rgba(217,169,78,.55); }
    .cap .w { display: inline-block; }
    .cap .acc { color: #B8566B; }
    .ui { position: absolute; }
    .ui img { display: block; width: 100%; filter: drop-shadow(0 10px 30px rgba(74,44,61,.25)); }
    #cursor { position: absolute; left: 0; top: 0; width: 64px; height: 64px; z-index: 50; }
    #cursor svg { width: 64px; height: 64px; display: block; transform-origin: 8px 6px; }
    .pop { position: absolute; font-size: 110px; line-height: 1; }
    #endline { position: absolute; left: 0; right: 0; bottom: 330px; text-align: center; }
    #endline span { display: inline-block; padding: 16px 40px 20px; background: rgba(251,233,168,.95); color: #4A2C3D; font: 400 64px/1 "Patrick Hand", cursive; transform: rotate(-1deg); box-shadow: 0 6px 18px rgba(74,44,61,.2); }
  </style>
  <div id="root" data-composition-id="studio" data-width="1920" data-height="1080">
    <div id="cam" data-layout-allow-overflow>''')
for lid, f, s0, s1 in LAYERS:
    html.append(f'      <div class="layer clip" id="{lid}" data-start="{s0}" data-duration="{round(s1 - s0, 2)}"><img id="{lid}-img" src="assets/shots/{f}.jpg" alt=""></div>')
html.append('    </div>')
for uid, f, s0, s1, x, y, w in UI:
    html.append(f'    <div class="ui clip" id="{uid}" data-start="{s0}" data-duration="{round(s1 - s0, 2)}" style="left:{x - w // 2}px; top:{y - 260}px; width:{w}px"><img id="{uid}-img" src="assets/shots/{f}.png" alt=""></div>')
mx, my = at("marta", 13.7)
html.append(f'    <div class="pop clip" id="pop-check" data-start="13.7" data-duration="0.7" style="left:{mx - 55}px; top:{my - 70}px"><span id="pop-check-in" style="display:inline-block">✅</span></div>')
sx, sy = at("sponge", 35.2)
html.append(f'    <div class="pop clip" id="pop-sparkle" data-start="35.2" data-duration="1.8" style="left:{sx - 55}px; top:{sy - 120}px"><span id="pop-sparkle-in" style="display:inline-block">✨</span></div>')
for cid, s0, s1, text, acc in CAPTIONS:
    html.append(f'    <div class="cap clip" id="{cid}" data-start="{s0}" data-duration="{round(s1 - s0, 2)}"><span class="tape">{words_html(cid, text, acc)}</span></div>')
html.append('    <div class="clip" id="plaque" data-start="42.6" data-duration="3.4"><div id="plaque-in"><i class="l"></i>Clayday<i class="r"></i></div></div>')
html.append('    <div class="clip" id="endline" data-start="43.0" data-duration="3.0"><span id="endline-in">your day, modelled by hand</span></div>')
html.append('''    <div class="clip" id="cursor" data-layout-allow-overflow data-start="3.2" data-duration="33.2"><svg id="cursor-svg" viewBox="0 0 64 64"><path d="M8 6 L8 52 L20 40 L29 58 L37 54 L28 37 L45 37 Z" fill="#FFF9EA" stroke="#4A2C3D" stroke-width="3.5" stroke-linejoin="round"/></svg></div>
  </div>
  <script>
    const tl = gsap.timeline({ paused: true });''')

js = []
c0 = CAMS[0]; x, y, s = cam_xy(*c0[1:4])
js.append(f'tl.set("#cam", {{ x: {x}, y: {y}, scale: {s} }}, 0);')
for t, cx, cy, sc, d, ease in CAMS[1:]:
    x, y, s = cam_xy(cx, cy, sc)
    js.append(f'tl.to("#cam", {{ x: {x}, y: {y}, scale: {s}, duration: {d}, ease: "{ease}" }}, {t});')
# layer changes
js.append('tl.fromTo("#l-dawnfull-img", { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: 1.3, ease: "power2.inOut" }, 4.2);')
for lid, s0, d in [("l-morning", 5.6, 1.6), ("l-done", 14.3, 0.35), ("l-noon", 37.6, 0.7), ("l-golden", 38.4, 1.2), ("l-dusk", 40.9, 1.2)]:
    js.append(f'tl.fromTo("#{lid}-img", {{ opacity: 0 }}, {{ opacity: 1, duration: {d}, ease: "power2.inOut" }}, {s0});')
# captions: words blur in, then blur out
for cid, s0, s1, text, acc in CAPTIONS:
    n = len(text.split(" "))
    for i in range(n):
        js.append(f'tl.fromTo("#{cid}-w{i}", {{ opacity: 0, filter: "blur(6px)" }}, {{ opacity: 1, filter: "blur(0px)", duration: 0.14, ease: "power2.out" }}, {round(s0 + 0.05 + i * 0.07, 3)});')
    js.append(f'tl.to("#{cid} .tape", {{ opacity: 0, filter: "blur(6px)", duration: 0.2, ease: "power2.in" }}, {round(s1 - 0.24, 3)});')
    js.append(f'tl.fromTo("#{cid} .tape", {{ scaleX: 0.6, opacity: 0 }}, {{ scaleX: 1, opacity: 1, duration: 0.25, ease: "power3.out" }}, {s0});')
# UI panels pop in and out
for uid, f, s0, s1, *_ in UI:
    js.append(f'tl.fromTo("#{uid}-img", {{ scale: 0.82, opacity: 0 }}, {{ scale: 1, opacity: 1, duration: 0.45, ease: "back.out(1.5)" }}, {s0});')
    js.append(f'tl.to("#{uid}-img", {{ scale: 0.9, opacity: 0, duration: 0.25, ease: "power3.in" }}, {round(s1 - 0.27, 3)});')
js.append('tl.fromTo("#pop-check-in", { scale: 0, rotation: -20 }, { scale: 1, rotation: 0, duration: 0.45, ease: "back.out(2.2)" }, 13.7);')
js.append('tl.to("#pop-check-in", { scale: 0.6, opacity: 0, duration: 0.2, ease: "power3.in" }, 14.15);')
js.append('tl.fromTo("#pop-sparkle-in", { scale: 0, rotation: 30 }, { scale: 1.1, rotation: 0, duration: 0.5, ease: "back.out(2.2)" }, 35.2);')
js.append('tl.to("#pop-sparkle-in", { scale: 0.6, opacity: 0, duration: 0.3, ease: "power3.in" }, 36.65);')
gx, gy = at("sign", 42.6)
js.append(f'tl.fromTo("#plaque-in", {{ x: {gx - 960}, y: {gy - 445}, scale: 0.4, rotation: -1.5 }}, {{ x: 0, y: 0, scale: 1, rotation: -1, duration: 0.8, ease: "back.out(1.3)" }}, 42.6);')
js.append('tl.fromTo("#plaque-in", { opacity: 0 }, { opacity: 1, duration: 0.15, ease: "power1.out" }, 42.6);')
js.append('tl.fromTo("#endline-in", { opacity: 0, filter: "blur(8px)", scaleX: 0.7 }, { opacity: 1, filter: "blur(0px)", scaleX: 1, duration: 0.4, ease: "power3.out" }, 43.0);')
# cursor
first = CURSOR[0]
js.append(f'tl.set("#cursor", {{ x: {first[1]}, y: {first[2]} }}, 3.2);')
prev_t = 3.2
for t, x, y, click in CURSOR[1:]:
    d = min(0.6, max(0.3, t - prev_t - 0.05))
    js.append(f'tl.to("#cursor", {{ x: {x - 8}, y: {y - 6}, duration: {round(d, 2)}, ease: "power3.out" }}, {round(t - d, 2)});')
    if click:
        js.append(f'tl.to("#cursor-svg", {{ scale: 0.82, duration: 0.07, ease: "power2.in", yoyo: true, repeat: 1 }}, {t});')
    prev_t = t

html.append("\n".join("    " + j for j in js))
html.append('''    window.__timelines["studio"] = tl;
  </script>
</template>''')
open("compositions/studio.html", "w").write("\n".join(html) + "\n")
print("cursor targets", [(t, x, y) for t, x, y, c in CURSOR if c])
