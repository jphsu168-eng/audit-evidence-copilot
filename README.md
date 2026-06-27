# Audit Evidence Copilot

An enterprise-style audit workbench built with HTML, CSS, and vanilla JavaScript. The project simulates an end-to-end revenue test-of-details workflow: engagement context, sample selection, evidence readiness, exception assessment, assertion testing, preparer status, and working-paper documentation.

> Educational portfolio project. All companies, people, documents, and transactions are fictional.

## Project Overview

Audit Evidence Copilot explores how a transparent, rules-based assistant could help an audit team organize revenue evidence and focus reviewer attention. It is deliberately framework-free and runs entirely in the browser, making the code and business logic easy to inspect.

The interface is designed as a professional workbench rather than a marketing dashboard. Dense data tables, engagement metadata, workflow controls, PBC references, assertion results, sign-off states, and print-ready documentation mirror the information hierarchy of enterprise audit software.

## Business Problem

Revenue testing often spans population extracts, evidence request lists, source documents, exception trackers, and working-paper templates. This fragmentation creates repetitive work and makes it difficult to answer three basic questions:

- Which samples require attention now?
- Is the evidence sufficient to support each relevant assertion?
- Does the working paper agree with the underlying test results?

This prototype centralizes those decisions and maintains a visible link between source data, risk signals, workflow status, and documentation.

## Features

- Engagement overview with materiality, population, coverage, and workflow stage.
- Significant-risk linkage for the presumed fraud risk in revenue recognition.
- Documented audit approach, relevant assertions, cutoff window, and population reconciliation.
- Ten realistic fictional revenue samples selected through random, cutoff, and high-value methods.
- Search plus combined risk and workflow-status filtering.
- Six-step workflow guide from sample selection through manager review.
- Evidence checklist with PBC state, document references, and assertion mapping.
- Downloadable client PBC request drafts generated only for missing support.
- Transparent risk assessment for:
  - Invoice-to-GL amount differences.
  - Revenue recognized before shipment.
  - Missing required evidence, weighted by document relevance.
  - Cash receipts occurring more than 60 days after recognition.
- Assertion testing matrix for occurrence, accuracy, cutoff, collectibility, and evidence sufficiency.
- Consolidated sample outcome showing risk, exception status, affected assertions, follow-up, and audit conclusion.
- Potential misstatement evaluation against the clearly trivial threshold.
- Manager review prompts that recommend responsive procedures without replacing professional judgment.
- Manager review workspace with review status, open and resolved comment counts, and manager conclusion.
- Persistent preparer workflow status using browser `localStorage`.
- Workflow guardrails that prevent preparer sign-off with missing evidence or unresolved exceptions.
- Manager-only review status simulation.
- Prioritized exception queue and 0–100 risk classification.
- Working-paper generator with sample rationale, objective, procedures, evidence, assertion results, exceptions, conclusion, and sign-off context.
- CSV export and browser-native Print / Save PDF support.
- Keyboard-accessible controls, responsive layouts, reduced visual clutter, and print styling.

## Risk Model

The score is a prioritization aid, not an audit conclusion.

| Signal | Score |
| --- | ---: |
| Invoice / GL mismatch below clearly trivial threshold | +15 |
| Invoice / GL mismatch at or above clearly trivial threshold | +30 |
| Recognition before shipment | +30 |
| Delayed cash receipt (>60 days) | +20 |
| Missing invoice | +25 |
| Missing sales contract | +15 |
| Missing shipping document | +25 |
| Missing cash receipt | +10 |
| Missing GL detail | +25 |

Scores are capped at 100 and classified as Low (0–19), Medium (20–54), or High (55–100). Rules and thresholds are defined in `data.js`, while the documented calculation lives in `script.js`.

The risk score is intentionally separated from the audit conclusion. A difference below the clearly trivial threshold remains an exception until its nature and cause are understood; missing support requires retrieval or a documented alternative procedure; and a cutoff exception prompts consideration of expanded year-end testing.

## Tech Stack

- Semantic HTML5
- Modern CSS with custom properties and responsive breakpoints
- Vanilla JavaScript (ES6+)
- Browser `localStorage`, Blob download, and print APIs

There is no React, Node.js runtime, build step, backend, database, authentication, third-party package, remote font, analytics script, or paid API.

## Run Locally

1. Clone or download the repository.
2. Open `index.html` in a modern browser.

No installation or local server is required.

## Project Structure

```text
audit-evidence-copilot/
├── index.html   # Semantic application shell and audit workspace
├── style.css    # Enterprise design system, responsive UI, and print layout
├── script.js    # Risk engine, state, rendering, workflow controls, and export
├── data.js      # Engagement configuration, risk rules, and fictional samples
└── README.md    # Product, technical, and portfolio documentation
```

## Architecture Notes

- `data.js` is the single configuration and mock-data source.
- The risk engine returns normalized findings with labels, points, and assertion context.
- A small application state object controls the active sample and combined filters.
- One sample-view render path controls rows, result counts, empty state, active selection, evidence, risk, and generator availability so the UI cannot present contradictory states.
- Audit outcome, PBC request, manager review, and working-paper content are derived from the same selected-sample state and exception model.
- Table interactions use event delegation, avoiding listener re-binding after each render.
- User-provided search values are never injected into generated markup.
- Mock text rendered into HTML is escaped defensively.
- Workflow overrides are isolated under a versioned `localStorage` key and safely fall back to session state.
- All core functionality remains available from a local `file://` page.

## Future V2 Roadmap

- Local document upload and evidence preview with simulated OCR extraction.
- Configurable firm methodology, assertions, thresholds, and approval gates.
- Sampling calculator with population stratification and projection of errors.
- Editable exception disposition notes and proposed adjustment tracking.
- Cross-sample analytics for customer concentration and cutoff trends.
- Immutable activity log and preparer/reviewer timestamps.
- WCAG audit with automated regression coverage.
- Optional secure backend for controlled multi-user collaboration.

## Portfolio Value

This project demonstrates product design and front-end engineering in a specialized professional-services domain. It translates audit concepts into a coherent information architecture, makes business rules inspectable, enforces workflow guardrails, supports accessible interaction, and produces documentation that stays consistent with the underlying test data—all without relying on a framework.

### Interview Talking Points

- Why a presumed revenue fraud risk drives targeted occurrence and cutoff procedures.
- Why population completeness and accuracy must be established before sampling.
- Why a rules-based score can prioritize work but cannot make an audit conclusion.
- Why differences below the clearly trivial threshold still require qualitative evaluation.
- How preparer and reviewer guardrails improve documentation quality and review efficiency.
- How the design maintains traceability from source evidence to assertion result and conclusion.

## Suggested Demo Walkthrough

1. Start on `REV-001` to demonstrate a complete, low-risk sample.
2. Select `REV-004` to show missing sales contract and cash receipt support, then generate its PBC request.
3. Select `REV-007` to demonstrate a $5,000 invoice-to-GL difference, cutoff exception, 100/100 risk score, affected assertions, and manager review points.
4. Generate the `REV-007` working paper and show how the evidence, exceptions, assertion impact, conclusion, preparer, reviewer, and review status trace back to the selected transaction.

## Legal Disclaimer

Audit Evidence Copilot is an educational portfolio prototype only. It is not affiliated with, endorsed by, or representative of any accounting firm. It does not provide audit, accounting, legal, or financial advice and must not be used for real client work. The risk score is illustrative and is not a substitute for professional judgment, applicable auditing standards, firm methodology, engagement supervision, or approved audit software.
