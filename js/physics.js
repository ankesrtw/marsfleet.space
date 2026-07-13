/* ============================================================
   physics.js — Wave 9: the one gravity constant.

   Until now the sim modelled NO gravity at all — not Earth's, not Mars'.
   Vertical motion was scripted everywhere: drone altitude was an
   input-driven accumulator (cut the power mid-air and it descended at a
   polite constant rate instead of falling), and the rover and humanoid
   snapped to terrain height every frame, so a cliff edge teleported them
   down its face.

   Mars pulls at 3.72 m/s^2 — 0.38 g. That number is the whole point: the
   same impulse arcs ~2.6x higher and hangs ~2.6x longer than it would on
   Earth, so a humanoid jump reads visibly, unmistakably off-world. Every
   unit that leaves the ground integrates against this one constant.
   ============================================================ */

export const GRAVITY_MARS = 3.72;   // m/s^2 (Earth: 9.81)
