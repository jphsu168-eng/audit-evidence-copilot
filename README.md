# Audit Evidence Copilot

Audit Evidence Copilot is an interactive revenue-testing workbench built with semantic HTML, modern CSS, and vanilla JavaScript. It simulates the day-to-day flow of an audit associate: select a sample, inspect evidence, document judgment, follow up with the client, prepare a working paper, and respond to manager review.

> Educational portfolio project. Every company, person, transaction, and document reference is fictional.

## Project Overview

The prototype models a year-end revenue test of details for a fictional technology company. Ten transactions move through a persistent preparer/reviewer workflow. One authoritative sample record drives the table, evidence checklist, risk assessment, PBC request, audit conclusion, workpaper, and manager-review state.

The application is intentionally dependency-free. Open `index.html` and the complete workbench runs locally in the browser.

## Business Problem

Revenue testing is often fragmented across population exports, PBC trackers, source documents, exception logs, and working-paper templates. That fragmentation creates repetitive updates and review friction: evidence can change without the risk assessment changing, a client request can disagree with the checklist, or a workpaper can become detached from the selected transaction.

Audit Evidence Copilot demonstrates a more traceable workflow:

- Source evidence changes recalculate risk and exception status.
- Missing support flows into a sample-specific PBC request.
- Notes, evidence, assertions, PBC status, and conclusions flow into the working paper.
- Workflow status and manager comments make ownership and review readiness visible.

## Features

### Associate workbench

- Ten realistic fictional revenue samples with invoice, GL, recognition, shipment, and subsequent-receipt attributes.
- Default selection of `REV-001`, with keyboard-accessible table rows and a clear selected state.
- Review statuses: Not Started, In Progress, Waiting for Client, Exception Noted, Ready for Manager Review, and Reviewed.
- Action buttons that update both the sample row and engagement dashboard.
- Search plus task filters for every workflow status, Missing Evidence, and High Risk.
- Dynamic workflow progress from sample selection through manager review.
- A consistent empty state that cannot conflict with the result count.

### Evidence, risk, and follow-up

- Toggleable checklist for invoice, sales contract, shipping document, cash receipt, and GL detail.
- Immediate recalculation of missing-evidence totals, risk score, risk level, assertion impact, and audit conclusion.
- Transparent exception rules for invoice-to-GL differences, premature recognition, missing evidence, delayed cash receipt, and round-dollar transactions.
- Explicit auditor disposition for No Exception, Exception Noted, or Follow-up Required.
- Editable sample-specific PBC request with Drafted, Sent, Received, and Not Required states.
- Readiness guardrails that prevent routing a sample while evidence remains outstanding.

### Documentation and review

- Persistent associate notes with save and clear actions.
- Editable working-paper draft containing objective, procedure performed, evidence reviewed, exceptions, assertion impact, conclusion, preparer, reviewer, and review status.
- Generated drafts refresh with source changes. Manually edited drafts are preserved and flagged when their source data changes.
- Manager comments include a persisted associate response and cannot be resolved without documented follow-up.
- Timestamped per-sample activity history records testing, documentation, PBC, submission, and review actions.
- All sample work survives refresh through a versioned `localStorage` model.
- Responsive desktop and mobile layouts, visible success messages, and accessible control labels.

## Risk Model

The rules-based score prioritizes audit attention; it does not replace professional judgment or form an audit opinion.

| Signal | Points |
| --- | ---: |
| Invoice-to-GL amount mismatch | +45 |
| Revenue recognized before shipment | +35 |
| Each missing evidence item | +15, capped at +45 |
| Cash receipt more than 45 days after recognition | +20 |
| Round-dollar transaction of at least $100,000 | +10 |

Scores are capped at 100 and classified as Low (0–24), Medium (25–64), or High (65–100). Rules and thresholds are configured in `data.js`; the documented calculation is implemented in `script.js`.

## Tech Stack

- HTML5
- CSS3 with custom properties and responsive breakpoints
- Vanilla JavaScript (ES6+)
- Browser `localStorage` and Clipboard APIs

There is no React, Node.js runtime, npm dependency, build step, backend, database, authentication, analytics, remote font, or paid API.

## Run Locally

1. Clone or download the repository.
2. Open `index.html` in a modern browser.

No installation or local server is required.

## Project Structure

```text
audit-evidence-copilot/
├── index.html   # Semantic workbench and workflow controls
├── style.css    # Enterprise visual system and responsive layout
├── script.js    # State, risk engine, rendering, persistence, and workflows
├── data.js      # Engagement configuration, rules, and fictional samples
└── README.md    # Product, audit, technical, and portfolio documentation
```

## Architecture Notes

- `data.js` is the immutable source for engagement context, risk configuration, and mock transactions.
- A normalized per-sample model owns evidence, risk, exception disposition, task status, notes, PBC state, workpaper state, review comments, responses, and activity history.
- One filtered-results array controls rows, selection reconciliation, empty-state visibility, and the authoritative result count.
- Derived selectors calculate assertions, follow-up, audit conclusion, and manager-review status from the active sample.
- Event delegation keeps table, evidence, and comment interactions reliable after rerendering.
- User-entered values are stored as text and escaped before insertion into generated markup.
- Versioned browser storage includes a safe migration path for earlier workflow-status data.

## Suggested Demo Walkthrough

1. Review `REV-001` as a complete, low-risk transaction.
2. Open `REV-004`, inspect its missing support, toggle an evidence item, and watch risk and dashboard metrics update.
3. Generate and copy the PBC request, then mark it Sent and Received.
4. Save an associate note and generate the working paper to demonstrate traceability.
5. Edit and save the draft, submit it for manager review, add a review comment, document the associate response, and resolve the review point.
6. Refresh the page and reopen the sample to demonstrate persistence.
7. Open `REV-007` to discuss its $5,000 difference, cutoff exception, affected assertions, and 100/100 risk score.

## Future V2 Roadmap

- Local document upload and evidence preview with simulated extraction.
- Configurable firm methodology, assertion sets, thresholds, and approval gates.
- Sampling calculator with population stratification and error projection.
- Proposed-adjustment and passed-adjustment tracking.
- Cross-sample analytics for customer concentration and cutoff trends.
- Optional export of the local activity trail for audit-file archiving.
- Automated accessibility and browser regression coverage.
- Optional secure backend for controlled multi-user collaboration.

## Portfolio Value

This project demonstrates product thinking, front-end engineering, UX design, and audit-domain fluency in one inspectable codebase. It turns professional judgment checkpoints into clear interactions, maintains traceability from transaction to conclusion, and shows how an enterprise workflow can be modeled without a framework.

Useful interview themes include:

- Why the presumed fraud risk in revenue recognition drives occurrence and cutoff procedures.
- Why a prioritization score must remain separate from the auditor’s conclusion.
- Why missing evidence is a sufficiency problem, not merely a document-count problem.
- How workflow guardrails, stale-draft protection, and review comments improve audit quality.
- How normalized state prevents contradictory information across an audit workbench.

## Legal Disclaimer

Audit Evidence Copilot is an educational prototype only. It is not affiliated with, endorsed by, or representative of Deloitte or any other accounting firm. It does not provide audit, accounting, legal, or financial advice and must not be used for real client work. Its rules and outputs are illustrative and are not a substitute for applicable auditing standards, firm methodology, engagement supervision, approved audit software, or professional judgment.
