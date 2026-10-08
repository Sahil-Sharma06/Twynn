# Frontend gaps

Places where the redesign brief asked for something the existing API does not provide. The rule for the redesign was to change only the frontend: when data is missing, the UI hides the element or shows a clear empty state, and the gap is listed here for a decision.

## Open gaps

None. Every screen in the brief is built from data the API already returns:

| Screen element                                                              | Source                                                                                                                  |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Overview stats, chart, layers, cost, models                                 | `/api/analytics/summary`, `/timeseries`, `/models`                                                                      |
| Live feed and newest-bar pulse                                              | `/api/events` (Server-Sent Events) and `/api/requests`                                                                  |
| Request explorer and detail, including the matched or closest stored prompt | `/api/requests`, `/api/requests/:id`                                                                                    |
| Cache browser and bulk clearing                                             | `/api/cache`, `/api/cache/:id`, `/api/cache/invalidate`                                                                 |
| Settings impact preview, histogram and flipping pairs                       | `/api/analytics/threshold-preview`                                                                                      |
| Playground results, matched prompt and timings                              | `/api/playground/chat/completions` headers, `/api/requests/:id`                                                         |
| Evaluate recommendation, strip and review cards                             | `/api/evaluation`, `/api/evaluation/labels/:id`, computed in the browser with `recommendThreshold` from `@twynn/shared` |

## Notes for later

These are not gaps in the API, but limits worth knowing:

- **Settings preview window** is fixed at the API's default of 7 days; the endpoint accepts `days` (1 to 30), so a window picker could be added in the UI alone.
- **Playground twin link** is drawn at a fixed height between the panes; with very long errors or prompts the panes can fall out of line and the link may not sit exactly level with the prompts. It is decorative and hidden from assistive technology.
- **Timings in the playground comparison** are measured in the browser, so they include network time between the browser and Twynn.
