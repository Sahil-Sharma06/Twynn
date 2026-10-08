# Frontend motion

Every animation in the Twynn dashboard and site, with its trigger, timing and what happens when the visitor prefers reduced motion.

Timings come from one place. CSS uses the tokens in `apps/web/src/styles/tokens.css`; JavaScript (Framer Motion, the Web Animations API, Three.js) uses `apps/web/src/lib/motion.ts`, which mirrors them.

| Token              | Value                              | Use                                       |
| ------------------ | ---------------------------------- | ----------------------------------------- |
| `--duration-fast`  | 120 ms                             | Hover and press feedback                  |
| `--duration-base`  | 200 ms                             | Small state changes, toasts, markers      |
| `--duration-slow`  | 420 ms                             | Entrances, panels, page transitions       |
| `--duration-story` | 900 ms                             | Storytelling: merges, chart growth        |
| `--ease-out`       | `cubic-bezier(0.2, 0.8, 0.2, 1)`   | Default for anything arriving             |
| `--ease-in-out`    | `cubic-bezier(0.65, 0, 0.35, 1)`   | Loops and drifts                          |
| `--ease-spring`    | `cubic-bezier(0.34, 1.3, 0.64, 1)` | Things settling into place (meter marker) |

## How reduced motion is handled

- **CSS animations and transitions**: a global rule in `styles/global.css` shortens every animation and transition to near zero and stops looping under `prefers-reduced-motion: reduce`. Animations use `both` or `backwards` fill so the element lands on its final state.
- **JavaScript animation** checks `useReducedMotion()` from `lib/motion.ts` and switches to an instant state change.
- **Three.js scenes** are never loaded under reduced motion (nor without WebGL); a static frame is rendered instead.

This is covered by tests: the landing falls back to its still frame without WebGL, the journey shows its outcome at once with reduced motion, and the Playwright accessibility suite runs with reduced motion enabled.

## Animations

### Public site

| Animation                   | Trigger                                    | Duration and easing                                                       | Reduced motion                                                     |
| --------------------------- | ------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Hero twin-bubble scene (3D) | Landing load; renders only while on screen | 7 s loop: drift, attract (0.22 to 0.48), overlap glow, fuse (0.56 to 0.7) | Not loaded; static frame of the merged state and the cached answer |
| Request journey             | Scrolled half into view; example buttons   | 400 ms start, 900 ms per lane, 2.6 s hold; token moves at 420 ms ease-out | Final state shown at once; no auto-advance                         |
| 404 bubbles passing         | Page load                                  | 2.4 s ease-in-out, once                                                   | Final frame: the bubbles sit apart, having missed                  |
| Logo mark approach          | Where `<Mark animated>` is used            | 900 ms ease-out, overlap appears after                                    | Final frame                                                        |

### Sign-in and onboarding

| Animation                | Trigger                       | Duration and easing                                         | Reduced motion                |
| ------------------------ | ----------------------------- | ----------------------------------------------------------- | ----------------------------- |
| Drifting bubble backdrop | Sign-up and log-in pages      | 26 s ease-in-out, alternating                               | Still                         |
| Auth card entrance       | Page load                     | 420 ms ease-out fade and rise                               | Instant                       |
| Step opening             | A step becomes current        | 420 ms ease-out                                             | Instant                       |
| Breathing mark           | Waiting for the first request | 2.8 s ease-in-out loop                                      | Still                         |
| First-request merge (3D) | The first request arrives     | 1.6 s once: bubbles swing in (0.9 s), overlap flares at 1 s | Not loaded; still merged mark |

### Dashboard

| Animation                       | Trigger                                   | Duration and easing                              | Reduced motion             |
| ------------------------------- | ----------------------------------------- | ------------------------------------------------ | -------------------------- |
| Page transition                 | Route change                              | 420 ms ease-out fade and 6 px rise               | Instant                    |
| Live indicator pulse            | Live stream connected                     | 2.4 s ease-out ring, looping                     | Still dot                  |
| Stat count-up                   | A headline number changes                 | 700 ms cubic ease-out (requestAnimationFrame)    | Jumps to the new value     |
| Stat light sweep                | A headline number changes                 | 900 ms ease-out, once                            | None                       |
| Chart bars grow                 | Chart appears or range changes            | 900 ms ease-out from the baseline                | Bars appear at full height |
| Newest bar pulse                | A live request arrives                    | 900 ms brightness pulse                          | None                       |
| Bucket spotlight                | Hover, focus or arrow keys on the chart   | 120 ms opacity                                   | Instant                    |
| Bucket detail panel             | A bucket is selected                      | 200 ms ease-out rise                             | Instant                    |
| Live feed row arrival           | A live request arrives                    | 900 ms slide in with a tinted highlight          | Row appears without motion |
| Proportion bar                  | Summary changes                           | 420 ms ease-out flex growth                      | Instant                    |
| Match score meter               | Meter appears; score or threshold changes | Fill 900 ms ease-out; marker 420 ms spring       | Final position at once     |
| Threshold histogram recolour    | Slider moves                              | 200 ms colour transition per bin                 | Instant                    |
| Would-be twin count             | Slider moves                              | 700 ms count tween                               | Jumps to the new value     |
| Cache detail panel              | An entry is selected                      | 200 ms ease-out slide                            | Instant                    |
| Playground twin link            | A pane returns a twin hit                 | Line draws in 420 ms; label rises after it       | Shown at once              |
| Playground answer               | A streamed answer arrives                 | Text appears as tokens arrive (not an animation) | Same                       |
| Evaluate strip dots and markers | A pair is labelled; recommendation moves  | 200 ms colour and position transitions           | Instant                    |
| Toasts                          | A confirmation is shown                   | 200 ms ease-out rise; dismissed after 4 s        | Appears without motion     |
| Skeleton shimmer                | Content loading                           | 1.4 s ease-in-out loop                           | Static placeholder         |
| Spinner                         | A button or page is busy                  | 0.7 s linear rotation, looping                   | Static ring                |
