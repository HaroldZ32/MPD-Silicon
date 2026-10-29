---
name: rtl-ip-flow
description: "RTL IP design workflow for the rtl-ip agent-teams roster profile, aligned to the four-swimlane flow (product market / system design / digital design / digital verification) with milestone gates (IP01 spec design / IP05 code design / IP08 design verification / IP10 release): requirements (app scenarios + feasibility + req trace) → specification (internal user manual + DFMEA initial + verification plan, reviews) → code design (RTL + detail design + env/case development + validation debug, reviews, spec-diff rollback) → verification and release (defect resolution + regression + design release + defect analysis). Use whenever an agent-teams run starts with --profile rtl-ip, or any RTL IP work needs the staged manual-first flow with review gates."
metadata:
  short-description: four-swimlane RTL-IP flow with review gates, milestone numbering and dual-track verification
---

# rtl-ip-flow

Execution contract for the `rtl-ip` agent-teams roster profile, structured after
the four-swimlane product flow: **产品市场 / 系统设计 / 数字设计 / 数字验证**, with
milestone tags **规格设计 IP01 → 代码设计 IP05 → 设计验证 IP08 → IP 发布 IP10**
and diamond review gates. AGENTS.md §7 and the mpd-verif tools stay authoritative
for invocation.

## Swimlanes and members

| Swimlane | Owner | Writes files |
| --- | --- | --- |
| 产品市场 (product market): 需求制定 | the user (captain assists) | no |
| 系统设计 (system design): 需求分析 | Requirement Analyst (read-only discipline) | no (reports + trace only) |
| 数字设计 (digital design): 规格设计/代码设计/设计发布/缺陷分析 | Spec Designer + RTL Code Engineer (chosen lane) | yes |
| 数字验证 (digital verification): 验证计划/环境/用例/验证调试/回归 | Verification Engineer | yes |
| 评审 (diamonds) | Reviewer / Plan Reviewer | no (findings only) |

Gate semantics (per the swimlane chart colors): **every diamond is passed by a
Reviewer check — red and green alike** (Reviewer / Plan Reviewer findings must be
clear before any review completes). The color only decides the extra step:
🔴 GATE = REVIEWERS FIRST, then a manual **user halt** (需求评审/规格评审/发布评审/
缺陷评审); 🟢 = reviewer-only, no user halt (设计评审/验证评审).

## Stage 0 — opening questions (before any work)

Ask the user once, batch together:

1. HDL language: **Verilog/SV** (code goes to RTL Code Engineer — Verilog/SV; code style
   contract = `rtl-codestyle` skill) or **SpinalHDL/Chisel** (code goes to RTL Code
   Engineer — SpinalHDL; follow the SpinalHDL conventions the user project already uses,
   e.g. RDC patterns: no hardware-computed parameters, no precision-losing resize,
   split register fields, doc-sync-after-every-change).
2. Verification backend: **open-source** (cocotb + verilator coverage), **VCS**
   (UVM + urg/FSDB via `mpd_verif_uvm`), or **auto-adapt** (probe `mpd_verif_backends`
   and pick the available lane).

Record both answers in the requirements summary; they are binding for the whole run.

## Stage 1 — 需求阶段 (requirements; no milestone)

- **需求制定 (product market)**: capture the initial request, then the **需求说明书**
  and **应用场景** with the user (captain writes the summary; user confirms the scenarios).
- **需求分析 (system design, Requirement Analyst)**: Socratic-question the user until
  unambiguous (feature set, interface/bus, registers, clock/reset, performance, non-goals,
  acceptance criteria); produce the **可行性报告** and **需求追踪表**; settle the
  requirements specification (`templates/req-spec.md`).
- 🔴 **GATE 需求评审** (Reviewer findings first, then manual user halt): user +
  Reviewers confirm the request, scenarios and trace; nothing proceeds without it.

## Stage 2 — 规格设计 IP01 (spec design)

- 数字设计 — Spec Designer: **内部用户手册** per `templates/user-manual.md` (full
  product-manual granularity; the internal version is the authoritative one) +
  **DFMEA 初版** per `templates/dfmea.md`; then write the manual into the project as
  `docs/user-manual.md` **AND** its English twin `docs/user-manual.en.md` (same
  section order, per `templates/user-manual.en.md`), and run the docgen tools —
  `mpd_docgen_run` with `manual: "docs/user-manual.md"` and
  `manualEn: "docs/user-manual.en.md"` — to produce `<ip>_regExcel_full.xlsx`,
  `<ip>_reg_user_manual.zh-CN.docx` and `<ip>_reg_user_manual.en.docx` in `docs/`.
- 数字验证 (parallel, **verification content front-loaded into this stage**) —
  Verification Engineer: ① drive **Socratic verification questions** at the Spec
  Designer until the design is verifiable — every feature point, interface signal,
  register field, boundary/exception, testability and coverage target must be
  explicit; ② **write the conclusions back into the spec documents** (verification
  points / testability constraints annotated into the internal user manual sections
  and the verification plan); ③ produce 验证计划 + 验证方案 per
  `templates/verification-plan.md`.
- 🔴 **GATE 规格评审** (Reviewer findings first, then manual user halt): Reviewer / Plan
  Reviewer check internal manual + DFMEA + verification plan/scheme, then the user
  reviews; the three docgen artifacts (`<ip>_regExcel_full.xlsx`,
  `<ip>_reg_user_manual.zh-CN.docx`, `<ip>_reg_user_manual.en.docx`) **must exist in
  `docs/` and `mpd_docgen_verify` must return ok with all three arguments named
  explicitly — `xlsx: "docs/<ip>_regExcel_full.xlsx"`,
  `docxZh: "docs/<ip>_reg_user_manual.zh-CN.docx"`,
  `docxEn: "docs/<ip>_reg_user_manual.en.docx"`** (V11 only runs when both docx are
  supplied, so `xlsx` alone is not a pass) — they are gate items, not optional; no
  code before it passes; revision loop repeats the spec/manual, never the code.
- 🟢 验证评审 (reviewer-only): Plan Reviewer / Reviewer check the verification plan
  against the manual — automatic, no user halt.

## Stage 3 — 代码设计 IP05 (code design)

- 数字设计 — RTL Code Engineer (chosen lane): implement per the confirmed internal user
  manual under the style contract; write the **详细设计** per `templates/detail-design.md`
  (one-to-one with the code, no code inside the doc).
- 数字验证 (parallel) — Verification Engineer: 环境开发 → 用例开发 → **验证调试**
  (验证报告 + 验证手册 per `templates/validation-report.md` / `templates/validation-manual.md`).
- **Consistency rule**: the detail manual and the code must carry **no non-essential
  difference** versus the user manual. On real divergence: stash stage-3 files
  (git stash / copy aside), re-run stage 2 to correct the internal manual, get it
  confirmed, return and redo stage 3 — never paper over the divergence.
- 🟢 **设计评审** + 🟢 **验证评审** (reviewer-only, no user halt): Reviewer / Plan
  Reviewer check code + detail manual + validation debug results; the verification
  engineer reports the manual-vs-code consistency check first.

## Stage 4 — 设计验证 IP08 → IP 发布 IP10 (verification and release)

- **缺陷解决 (design) ↔ 验证调试/回归 (verification)**: defects found in validation debug
  are fixed by the RTL code engineer; the verification engineer reruns the affected cases
  and then the full **回归验证** (dual-track).
- Track 1 — functional per the internal user manual (cocotb lane or UVM lane per backend;
  every scenario covered; all cases PASS).
- Track 2 — coverage per the detail design manual (verilator merge/report or VCS urg +
  fsdbreport; plan targets met or justified).
- **设计发布**: 内部用户手册 + **外部用户手册** (public version, internal details and
  DFMEA removed) per `templates/user-manual.md` → 🔴 **GATE 发布评审** (Reviewer
  findings first, then manual user halt).
- **缺陷分析**: 缺陷报告 + Buglist per `templates/defect-report.md` → 🔴 **GATE 缺陷评审**
  (Reviewer findings first, then user halt; closure criteria before IP10).
- IP10 = release milestone: all reviews green, dual-track evidence committed.

## Document matrix (1. / 2. as in the swimlane chart)

| Deliverable | Stage | Template |
| --- | --- | --- |
| 需求说明书 / 应用场景 | 1 | `req-spec.md` (§背景与目标 / §应用场景) |
| 可行性报告 / 需求追踪表 | 1 | `req-spec.md` (§可行性 / §需求追踪表) |
| 内部用户手册 + DFMEA 初版 | 2 | `user-manual.md` / `dfmea.md` |
| 寄存器 Excel + 用户手册 docx（中英） | 2 | generated by `mpd_docgen_run` from the two manuals |
| 验证计划 + 验证方案 | 2 | `verification-plan.md` |
| 详细设计 | 3 | `detail-design.md` |
| 验证报告 + 验证手册 | 3 | `validation-report.md` / `validation-manual.md` |
| 内部/外部用户手册 | 4 | `user-manual.md` (internal + external variant) |
| 缺陷报告 + Buglist | 4 | `defect-report.md` |

## Consistency checklist (every gate)

- 需求追踪表 ↔ req spec ↔ user manual: every Req has a manual section; no orphans.
- Detail manual ↔ code: interface list, module hierarchy, FSM states/transitions,
  parameters, clock/reset domains one-to-one.
- Verification plan ↔ user manual: every feature point and config scenario has at least
  one test case id; every coverage item cites a design-manual section.
- DFMEA ↔ user manual: every failure mode maps to a feature or register behavior.
- xlsx/docx registers ↔ user manual: `mpd_docgen_verify` ok; zh/en register skeleton identical.
- Internal vs external user manual: external is a pure subset (no internal details).
- All human-facing deliverables of the flow are Chinese, and the internal user manual
  additionally ships an English twin that feeds the English docx; agent-facing logs/commit
  messages stay English.
