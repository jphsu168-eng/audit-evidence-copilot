# Audit Evidence Copilot

Audit Evidence Copilot is a task-driven revenue testing workbench built with semantic HTML, modern CSS, and vanilla JavaScript. It simulates the end-to-end work of an Audit Associate: select a sample, inspect support, document judgment, follow up with the client, prepare a working paper, and clear manager review points.

> All companies, people, transactions, and evidence references are fictional.

## Project Overview

The prototype models a year-end revenue test of details for a fictional technology issuer under ASC 606. Ten synthetic transactions move through one persistent preparer/reviewer workflow. The selected sample record drives every panel, so evidence, risk, exceptions, PBC requests, conclusions, workpapers, and review comments remain traceable to the same transaction.

The application has no dependencies or build step. Open `index.html` and the complete workbench runs locally in the browser.

## Business Problem

Revenue testing is often split across population exports, PBC trackers, source documents, exception logs, and working-paper templates. Repeating the same facts in multiple places creates avoidable review friction and inconsistency. An evidence change may not reach the risk assessment; a PBC request may disagree with the checklist; a workpaper may describe support that was never received.

This prototype demonstrates a connected workflow in which source evidence drives risk, client follow-up, documentation, and review readiness.

## Why This Matters

Audit quality depends on traceability: the support inspected, tickmarks applied, exceptions identified, client follow-up performed, and conclusion documented should tell one consistent story. A task-driven workbench reduces missed handoffs and gives reviewers a visible basis for deciding whether a sample is genuinely ready for review—not merely labeled complete.

## Target Users

- Audit Associates performing revenue tests of details.
- Seniors monitoring sample progress, evidence sufficiency, and exceptions.
- Managers reviewing conclusions, proposed resolutions, and open review points.
- Recruiters and engineering interviewers evaluating audit-domain product thinking.

## Task-Driven Audit Workflow

1. Select one of ten revenue samples.
2. Start the review and inspect transaction timing and amounts.
3. Move five evidence items through Not Received, Received, Reviewed, or Exception; assign a tickmark and optional evidence note.
4. Document notes, management’s explanation, and a proposed resolution.
5. Record an auditor exception decision and assess its quantitative impact.
6. Generate, edit, copy, send, and receive a sample-specific PBC request.
7. Generate, edit, and save a revenue working paper.
8. Satisfy the manager-review readiness checklist and submit the sample.
9. Add manager comments, document associate responses, and resolve review points.
10. Retain each action in a timestamped sample activity log.

The interface uses sample-level task states: Not Started, In Progress, Waiting for Client, Exception Noted, Ready for Manager Review, and Reviewed. A six-step workflow navigator and current-task recommendation turn those states into specific associate actions. Dashboard metrics, table badges, filters, workflow progress, and manager readiness update from the same application state.

## Audit Rules Designed

The workflow preserves core revenue concepts: occurrence, accuracy, cutoff, collectibility, evidence sufficiency, clearly trivial differences, performance materiality, PBC follow-up, preparer sign-off, and manager review. Rules identify invoice-to-GL differences, recognition before shipment, incomplete evidence, evidence exceptions, receipts more than 60 days after invoice, and high-value round-dollar transactions.

The rules prioritize attention. They do not make an audit decision; the associate must record a disposition and supporting rationale.

## Risk Scoring Logic

| Signal | Points |
| --- | ---: |
| Invoice-to-GL amount mismatch | +30 |
| Revenue recognized before shipment | +35 |
| Each evidence item not Reviewed | +10 |
| Each evidence item marked Exception | Additional +20 |
| Cash receipt more than 60 days after invoice | +15 |
| Round-dollar transaction of at least $100,000 | +10 |

Scores are capped at 100 and classified as Low (0–29), Medium (30–59), or High (60–100). Assertion mapping connects amount differences to Accuracy, timing issues to Cutoff, and missing source support to the relevant Occurrence, Accuracy, Cutoff, or Collectibility follow-up.

## Evidence Reference and Tickmark System

Every sample contains an Invoice, Sales Contract, Shipping Document, Cash Receipt, and GL Detail reference. IDs such as `INV-001`, `CON-001`, `SHIP-001`, `BANK-001`, and `GL-001` flow into the checklist, PBC request, exception evaluation, and generated working paper.

Each evidence record also retains a tickmark—✓ Agreed, M Missing, E Exception, F Follow-up, or N/A Not applicable—and an optional cross-reference note. Generated workpapers cite the reference, status, tickmark, and note together. Missing evidence is described as not provided; the generator never claims successful inspection for support that is Not Received.

## PBC Workflow

Client requests are generated only from the active sample’s unresolved support and risk conditions. The editable request can be copied and moved through Not Required, Drafted, Sent, and Received. PBC actions update the dashboard, sample row, working-paper source, and activity trail; the prototype records state locally and sends no communication.

## Working Paper Workflow

The generator creates a selected-sample revenue memo containing the objective, procedure, evidence status and references, exceptions, assertion impact, management explanation, proposed resolution, audit notes, conclusion, preparer, reviewer, and review status. Generated text remains editable. Manually customized drafts are preserved and flagged as stale when source data changes.

## Manager Review Workflow

Managers can add timestamped review comments. Associates can save a response, and a comment cannot be resolved without one. Open and resolved counts drive the manager conclusion, and final Reviewed status is blocked while review points remain open.

## Manager Review Readiness Gate

Submission is controlled by a derived seven-item checklist: review started, evidence review completed, exception decision completed, audit note saved, PBC addressed when applicable, working paper generated, and working paper saved. Each check displays Completed, Missing, or Not applicable. The sample cannot move to Ready for Manager Review until all required checks pass.

## Export Features

The selected sample can be exported entirely in the browser:

- Working paper as a `.txt` file.
- Timestamped activity log as a `.txt` file.
- Full sample review state—including evidence tickmarks and notes, PBC, workpaper, manager comments, and activity history—as formatted `.json`.

Exports use the browser Blob API. No data is transmitted to a server.

## LocalStorage Persistence

A single `appState` object is the source of truth and is stored under `auditEvidenceCopilotState`. It contains the selected sample, all ten sample records, task status, evidence lifecycle, references, tickmarks, evidence notes, exception assessment, audit notes, PBC state, working-paper draft, review comments, and activity history. Invalid or partial saved state falls back to the ten default samples, and earlier prototype keys are migrated and removed.

To reset the demonstration, clear local site data for the file or remove `auditEvidenceCopilotState` in browser developer tools.

## Tech Stack

- HTML5
- CSS3 with design tokens and responsive breakpoints
- Vanilla JavaScript (ES6+)
- Browser Local Storage and Clipboard APIs

There is no React, Node.js runtime, npm dependency, backend, database, authentication, remote font, analytics service, or paid API.

## How to Run Locally

1. Clone or download this repository.
2. Open `index.html` in a modern browser.

No installation or local server is required.

## Project Structure

```text
audit-evidence-copilot/
├── index.html   # Semantic workbench and workflow controls
├── style.css    # Enterprise visual system and responsive layout
├── script.js    # State, risk engine, rendering, persistence, and workflows
├── data.js      # Engagement configuration, rules, and synthetic samples
└── README.md    # Product, audit, technical, and portfolio documentation
```

## Architecture Notes

- `data.js` supplies immutable engagement context, risk configuration, and mock transactions.
- One normalized `appState.samples` array owns all mutable sample data.
- One filtered-results array controls table rows, empty state, count text, and selected-row reconciliation.
- Derived functions calculate risk, assertions, follow-up, PBC requirements, conclusions, and review status.
- Render functions receive the selected sample explicitly to prevent stale cross-sample content.
- Event delegation keeps dynamic table, evidence, and review-comment interactions reliable.
- User-entered content is escaped before insertion into generated HTML.

## Suggested Demo Walkthrough

1. Open `REV-001`, start the review, and inspect its complete evidence set.
2. Open `REV-004`; its contract and cash support demonstrate client follow-up and cutoff risk.
3. Change an evidence status and watch completion, risk, assertions, dashboard counts, and PBC requirements update.
4. Record the exception decision, management explanation, proposed resolution, and an audit note.
5. Generate the PBC request, mark it Sent and Received, then generate and edit the workpaper.
6. Submit for manager review, add a review point, save an associate response, and resolve the comment.
7. Refresh the page to demonstrate persistence.

## My Product Design Contribution

- Designed the audit workflow from sample selection to manager review.
- Defined rule-based risk scoring logic.
- Mapped audit issues to financial statement assertions.
- Designed the evidence reference and tickmark workflow.
- Designed the PBC request and working paper generation workflow.
- Structured the roadmap from static prototype to AI-enabled audit platform.

## Future V2 Roadmap

- Local evidence upload and side-by-side document preview.
- Configurable methodology, assertions, thresholds, and approval gates.
- Sampling calculator, population stratification, and projected-error evaluation.
- Proposed and passed adjustment tracking.
- Cross-sample exception and customer-concentration analytics.
- Exportable audit trail and working-paper package.
- Automated accessibility and browser regression coverage.
- Optional secure backend for controlled multi-user collaboration.

## Limitations

- The evidence is represented by synthetic statuses and references; documents are not uploaded or validated.
- No real client data is used. Do not upload, paste, or otherwise enter confidential client information.
- Risk scoring is illustrative and is not a firm methodology or authoritative audit program.
- Browser storage is device-local and provides no access control, concurrency, backup, or retention guarantee.
- Clipboard behavior can vary when a browser opens the project from `file://`.
- The app does not send PBC requests, issue audit opinions, or integrate with client systems.

## Portfolio Value

The project combines product strategy, frontend architecture, enterprise UX, and audit-domain fluency in one inspectable codebase. It demonstrates how a normalized state model, transparent rules, workflow guardrails, stale-draft protection, and reviewer feedback can turn static audit content into an operational task flow.

## Legal and Audit Disclaimer

This project is an educational portfolio prototype. It does not issue audit opinions, does not replace CPA judgment, and should not be used as a production audit system. All data is synthetic mock data.

No real client data is used. Do not upload confidential client data. This is an educational portfolio prototype only.

Audit Evidence Copilot is not affiliated with, endorsed by, or representative of Deloitte or any other accounting firm. It does not provide audit, accounting, legal, or financial advice and is not a substitute for applicable auditing standards, firm methodology, engagement supervision, approved audit software, or professional judgment.
