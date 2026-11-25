# 段階 ④ の記録（v0.39.0、2026-11-25）

# SDD ledger — plan: docs/superpowers/plans/2026-11-25-stage4-sort-view.md
Pre-flight: Task 2 consumes sortCategories/renumberCategories/api.reorderCategories from Task 1 — signatures match.
Task 1: complete (commits 5b3f16a..3e0d23b, tests: npx vitest run src/tests/studioOrder.test.ts tools/content/merge3.test.ts → [2m   Duration [22m 499ms[2m (transform 128ms, setup 119ms, import 90ms, tests 19ms, environment 324ms)[22m)
Task 2: Ruling: the E2E was not watched failing before the implementation (the studio tests are serial and build the doll in earlier tests; running the one test alone fails for an unrelated reason) — the test asserts test IDs that did not exist before, so it could not have passed — cost if wrong: a test that never catches a regression.
Task 2: Ruling: "same place" drop is tested by dragging to the item's own left edge, not with no movement — Playwright's no-move drag is a click, which correctly opens くわしく — none.
Task 2: Ruling: set drag is tested with a temporary second set added and removed through the studio API (the fixture doll has only 1 set at that point) — the plan said "only if 2+ sets", which would never run — none.
Task 2: complete (commits 3e0d23b..2201645, tests: env PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test e2e/studio.spec.ts --trace off --reporter=line → [1A[2K  17 passed (1.2m))
Final review: Opus reviewer — Ready to merge: Yes. 0 Critical, 0 Important, 6 Minor.
Final: Ruling: re-graded Minor 1 (tie-break differs from game) to Important — the real content (おんなのこ) has てぶくろ/ソックス both menuOrder 3 and てぶくろ's first item overrides layer 8, so the game shows ソックス first but the sort view showed てぶくろ first; the first unrelated category drag would silently flip them in the game — cost if wrong: none (fix is small).
Final: fixed tie-break — sortCategories now takes doll.items (first item's layer ?? category layer, then first item's position; empty categories last) — studioOrder.test 'ゲームと同じ、同じ menuOrder の決め方' RED→GREEN, unit 1183/1183.
Final: Ruling: re-graded Minor 2 (overlapping saves undo the earlier move) to Important — a quick second drag silently reverts the first — cost if wrong: none.
Final: fixed overlapping saves — drops ignored while saving (ref + aria-busy) — e2e 'ならべかえ: 保存している間に落としたものは、無視する' RED→GREEN, studio e2e 18/18.
Final: minor (deferred): drop line can stay shown while hovering a gap/other row (no onDragLeave); cleared on dragend.
Final: minor (deferred): switching to ならべかえ while 位置・大きさ dialog is open would close it (overlay covers the switcher, likely unreachable).
Final: minor (deferred): no E2E for a failed save (code path uses the same guard as before).
Final: minor (deferred): unused categories/setNames computed before the sort-view early return in Library; waitForTimeout(500) in the no-change check.
Final: e2e all: 145 passed, 1 failed (dressup.spec.ts:1059 一覧が画面に収まるとき) — also fails on origin/main in this environment, pre-existing, unrelated
