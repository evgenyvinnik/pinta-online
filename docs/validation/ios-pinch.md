# Physical iPhone / iPad Safari pinch acceptance

**All results pending.** Browser automation and synthetic `gesturechange` events do not count as
physical-device validation. Evgeny has offered to test iPhone/iPad Safari.

## Preparation (about two minutes)

1. Export any important open documents first. Use a dedicated test document, not private artwork.
2. Open <https://paint.rip/> in Safari. Record the version displayed in Help → About, device model,
   iOS/iPadOS version, orientation, page zoom and whether this is Safari or a Home Screen app.
3. Save [pinch-target.svg](pinch-target.svg) to Files and open it using Pinta's Open command.
   Alternatively use a disposable image with a clearly visible central landmark. The supplied
   target is 1200×900, with 100-pixel grid squares and a red center crosshair.
4. Set Safari's page zoom to 100% for the initial run. Record Pinta's image zoom, active layer and
   current History entry. Enable screen recording if possible; a recording does not show finger
   locations, so state where the fingers were placed in your notes.

## Cases

Run P1–P7 in portrait and landscape on each available device. Check landscape separately after
rotation; do not extrapolate a portrait pass. Repeat on iPad split view and the Home Screen app
if those are workflows you use. Mark unavailable combinations **not tested**, not passed.

| ID | Action | Pass criteria |
| --- | --- | --- |
| P1 | Select Pan. Spread then pinch two fingers around the red center, five times slowly and five times quickly. | Pinta image zoom changes smoothly in the correct direction. Toolbars do not enlarge, Safari does not navigate, and the document gains no paint/history entry. |
| P2 | Start zoomed in with the canvas scrollable. Pinch around an off-center landmark. | The same image landmark stays near the gesture midpoint, without jumps to the canvas center. At a scroll boundary exact anchoring can be constrained; no accumulating drift away from a free anchor. |
| P3 | Select Paintbrush. Put one finger down, then a second; pinch; lift one, then the other. Repeat with the opposite release order. | Two-finger zoom does not leave a dot, line, active stroke, or new History entry. The next deliberate one-finger brush stroke draws once and Undo removes it. This is a high-priority gesture/drawing handoff check. |
| P4 | Make a rectangle selection. Pinch in/out and pan. Repeat with a magic-wand selection. | Selection remains active and follows image pixels; ants/handles scale with the canvas. Pinching does not move, resize, fill, or bake the selection into the image. |
| P5 | Begin pinching inside the canvas, move toward/outside its edge, release; then draw and pan again. Interrupt once by switching apps. | No stuck pointer, runaway zoom, page navigation, or lost input after returning. Previously finished edits remain intact. |
| P6 | Zoom toward both bounds, reverse direction, rotate the device, then repeat P1. | Zoom stays within 5%–3600%, recovers immediately on reversing, and the canvas/controls remain reachable after rotation. |
| P7 | Place text to open the keyboard; dismiss it, pinch, and re-edit the text. Open a color/effect dialog and try pinching over the dialog. | Text remains editable with no unexpected edits. Pinching a modal does not zoom the image behind it. Dismissing keyboard/dialog restores normal canvas interaction. |

For P3/P4 compare History before/after and use Undo deliberately to check for hidden edits. Do not
call a visually unchanged canvas a pass if pinching added an undo step. A screen recording, the
test's ID and the before/after zoom values are more useful than “zoom felt wrong.”

## Result to return

```text
Date / tester:
Device / iOS or iPadOS:
Pinta version:
Safari tab or Home Screen app:
Orientation / split view / Safari page zoom:
P1: pending
P2: pending
P3: pending
P4: pending
P5: pending
P6: pending
P7: pending
Failed case: exact actions, expected vs actual, before/after Pinta zoom and History:
Recording / screenshots / exported disposable document:
```

Report failures at <https://github.com/evgenyvinnik/pinta-online/issues/new?template=bug.md>.
Do not clear website storage as a troubleshooting step before exporting work and recording the
failure; that would erase the state needed to diagnose restoration problems.
