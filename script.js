(function () {
  "use strict";

  const STORAGE_KEY = "auditEvidenceCopilotState";
  const LEGACY_STORAGE_KEYS = ["audit-evidence-copilot.workbench.v2", "audit-evidence-copilot.workflow.v1"];
  const DEFAULT_SAMPLE_ID = "REV-001";

  const evidenceDefinitions = {
    invoice: { label: "Invoice", prefix: "INV" },
    salesContract: { label: "Sales Contract", prefix: "CON" },
    shippingDocument: { label: "Shipping Document", prefix: "SHIP" },
    cashReceipt: { label: "Cash Receipt", prefix: "BANK" },
    glDetail: { label: "GL Detail", prefix: "GL" }
  };
  const evidenceLabels = Object.fromEntries(Object.entries(evidenceDefinitions).map(([key, value]) => [key, value.label]));
  const evidenceStatuses = ["Not Received", "Received", "Reviewed", "Exception"];
  const tickmarkOptions = ["✓ Agreed", "M Missing", "E Exception", "F Follow-up", "N/A Not applicable"];

  function defaultTickmark(status) {
    return {
      Reviewed: "✓ Agreed",
      "Not Received": "M Missing",
      Received: "F Follow-up",
      Exception: "E Exception"
    }[status] || "F Follow-up";
  }

  const byId = (id) => document.getElementById(id);
  const currency = (value) => new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
  const signedCurrency = (value) => `${value < 0 ? "-" : ""}${currency(Math.abs(value))}`;
  const formatDate = (value) => value ? new Date(`${value}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }) : "Not available";
  const today = () => new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric"
  });
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  })[character]);
  const slug = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  function normalizeStatus(status) {
    const aliases = {
      Prepared: "Ready for Manager Review",
      "Ready for Review": "Ready for Manager Review",
      "In progress": "In Progress",
      "Awaiting evidence": "Waiting for Client",
      Exception: "Exception Noted"
    };
    const normalized = aliases[status] || status;
    return ["Not Started", "In Progress", "Waiting for Client", "Exception Noted", "Ready for Manager Review", "Reviewed"].includes(normalized)
      ? normalized
      : "Not Started";
  }

  function normalizePbcStatus(status) {
    if (status === "Draft") return "Drafted";
    return ["Not Required", "Drafted", "Sent", "Received"].includes(status) ? status : "Not Required";
  }

  function normalizeExceptionDecision(value) {
    const aliases = {
      "No exception noted": "No Exception Noted",
      "Exception noted": "Exception Noted",
      "Follow-up required": "Follow-up Required",
      "Not evaluated": "Not Assessed"
    };
    const normalized = aliases[value] || value;
    return ["Not Assessed", "No Exception Noted", "Exception Noted", "Follow-up Required"].includes(normalized) ? normalized : "Not Assessed";
  }

  function loadPersistedState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (saved && Array.isArray(saved.samples)) return saved;

      const legacyWorkbench = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEYS[0]) || "{}");
      if (legacyWorkbench.samples && typeof legacyWorkbench.samples === "object") {
        return { samples: Object.entries(legacyWorkbench.samples).map(([id, value]) => ({ id, ...value })) };
      }
      const legacyStatuses = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEYS[1]) || "{}");
      return { samples: Object.entries(legacyStatuses).map(([id, taskStatus]) => ({ id, taskStatus })) };
    } catch (error) {
      console.warn("Saved workbench state could not be loaded.", error);
      return { samples: [] };
    }
  }

  function normalizeEvidence(baseSample, savedSample) {
    const suffix = baseSample.id.replace(/\D/g, "").padStart(3, "0");
    return Object.fromEntries(Object.entries(evidenceDefinitions).map(([key, definition]) => {
      const saved = savedSample?.evidence?.[key];
      const base = baseSample.evidence[key];
      const status = typeof saved === "object" && evidenceStatuses.includes(saved.status)
        ? saved.status
        : saved === true || (saved === undefined && base === true) ? "Reviewed" : "Not Received";
      const tickmark = typeof saved === "object" && tickmarkOptions.includes(saved.tickmark) ? saved.tickmark : defaultTickmark(status);
      const note = typeof saved === "object" && typeof saved.note === "string" ? saved.note : "";
      return [key, { label: definition.label, status, ref: typeof saved === "object" && saved.ref ? saved.ref : `${definition.prefix}-${suffix}`, tickmark, note }];
    }));
  }

  function incompleteEvidence(sample) {
    return Object.entries(sample.evidence)
      .filter(([, item]) => item.status !== "Reviewed")
      .map(([key]) => evidenceLabels[key]);
  }

  function notReceivedEvidence(sample) {
    return Object.entries(sample.evidence)
      .filter(([, item]) => item.status === "Not Received")
      .map(([key]) => evidenceLabels[key]);
  }

  // Risk scoring mirrors a simple revenue test-of-details triage model. The score is
  // intentionally explainable: each exception adds a documented number of points.
  function assessRisk(sample) {
    const difference = sample.glAmount - sample.invoiceAmount;
    const mismatch = Math.abs(difference) > 0.01;
    const recognizedBeforeShipment = new Date(sample.revenueDate) < new Date(sample.shippingDate);
    const cashDays = Math.round((new Date(sample.cashReceiptDate) - new Date(sample.invoiceDate)) / 86400000);
    const delayedCash = cashDays > riskRules.delayedCashDays;
    const roundDollar = sample.invoiceAmount >= 100000 && sample.invoiceAmount % 1000 === 0;
    const incomplete = incompleteEvidence(sample);
    const missing = notReceivedEvidence(sample);
    const evidenceExceptions = Object.values(sample.evidence).filter((item) => item.status === "Exception").length;
    const incompleteCount = Object.values(sample.evidence).filter((item) => item.status !== "Reviewed").length;
    const points = {
      mismatch: mismatch ? riskRules.amountMismatch : 0,
      cutoff: recognizedBeforeShipment ? riskRules.prematureRecognition : 0,
      evidence: incompleteCount * riskRules.incompleteEvidence,
      evidenceExceptions: evidenceExceptions * riskRules.evidenceException,
      delayedCash: delayedCash ? riskRules.delayedCashReceipt : 0,
      roundDollar: roundDollar ? riskRules.roundDollarTransaction : 0
    };
    const score = Math.min(100, Object.values(points).reduce((total, value) => total + value, 0));
    const level = score >= riskRules.thresholds.high ? "High" : score >= riskRules.thresholds.medium ? "Medium" : "Low";
    const findings = [];

    if (mismatch) findings.push(`Invoice-to-GL difference of ${signedCurrency(difference)}`);
    if (recognizedBeforeShipment) findings.push("Revenue recognized before shipment");
    if (incomplete.length) findings.push(`${incomplete.length} evidence item${incomplete.length === 1 ? " is" : "s are"} not reviewed`);
    if (evidenceExceptions) findings.push(`${evidenceExceptions} evidence exception${evidenceExceptions === 1 ? "" : "s"} identified`);
    if (delayedCash) findings.push(`Cash receipt collected ${cashDays} days after invoice`);
    if (roundDollar) findings.push("Round-dollar transaction selected for enhanced scrutiny");

    return { difference, mismatch, recognizedBeforeShipment, cashDays, delayedCash, roundDollar, missing, incomplete, evidenceExceptions, points, score, level, findings };
  }

  const persistedState = loadPersistedState();
  const persistedById = Object.fromEntries((persistedState.samples || []).map((sample) => [sample.id, sample]));
  const defaultSamples = revenueSamples.map((baseSample) => {
    const saved = persistedById[baseSample.id] || {};
    const migratedNotes = Array.isArray(saved.auditNotes)
      ? saved.auditNotes
      : typeof saved.auditNotes === "string" && saved.auditNotes.trim()
        ? [{ id: `NOTE-${baseSample.id}-MIGRATED`, text: saved.auditNotes, timestamp: "Previously saved" }]
        : [];
    const sample = {
      ...baseSample,
      invoiceNumber: baseSample.invoice,
      invoiceDate: baseSample.invoiceDate || baseSample.recognitionDate,
      revenueDate: baseSample.recognitionDate,
      evidence: normalizeEvidence(baseSample, saved),
      taskStatus: normalizeStatus(saved.taskStatus || saved["workflowStatus"] || baseSample.workflowStatus),
      auditNotes: migratedNotes,
      draftAuditNote: typeof saved.draftAuditNote === "string" ? saved.draftAuditNote : "",
      managementExplanation: typeof saved.managementExplanation === "string" ? saved.managementExplanation : "",
      proposedResolution: typeof saved.proposedResolution === "string" ? saved.proposedResolution : "",
      pbcStatus: normalizePbcStatus(saved.pbcStatus),
      pbcRequest: typeof saved.pbcRequest === "string" ? saved.pbcRequest : typeof saved["pbcText"] === "string" ? saved["pbcText"] : "",
      pbcAddressed: Boolean(saved.pbcAddressed || saved.pbcStatus === "Received"),
      workingPaperDraft: typeof saved.workingPaperDraft === "string" ? saved.workingPaperDraft : "",
      workingPaperStatus: saved.workingPaperStatus || "Not Started",
      workingPaperSaved: typeof saved.workingPaperSaved === "boolean" ? saved.workingPaperSaved : Boolean(saved.workingPaperDraft && saved.workingPaperCustomized),
      workingPaperCustomized: Boolean(saved.workingPaperCustomized),
      workingPaperStale: Boolean(saved.workingPaperStale),
      managerComments: Array.isArray(saved.managerComments) ? saved.managerComments.map((comment) => ({ response: "", responseAt: "", ...comment })) : [],
      exceptionDecision: normalizeExceptionDecision(saved.exceptionDecision),
      activityLog: Array.isArray(saved.activityLog) ? saved.activityLog : []
    };
    sample.risk = assessRisk(sample);
    if (sample.taskStatus === "Reviewed" && sample.workingPaperDraft) {
      sample.workingPaperStatus = "Reviewed";
      sample.workingPaperStale = false;
    }
    if (sample.exceptionDecision === "Not Assessed") {
      if (["Waiting for Client"].includes(sample.taskStatus)) sample.exceptionDecision = "Follow-up Required";
      else if (["Exception Noted"].includes(sample.taskStatus)) sample.exceptionDecision = "Exception Noted";
      else if (["Ready for Manager Review", "Reviewed"].includes(sample.taskStatus)) sample.exceptionDecision = sample.risk.findings.length ? "Exception Noted" : "No Exception Noted";
      else sample.exceptionDecision = "Not Assessed";
    }
    if (!pbcRequirements(sample).length) {
      if (!sample.pbcRequest || !["Sent", "Received"].includes(sample.pbcStatus)) {
        sample.pbcStatus = "Not Required";
        sample.pbcRequest = "";
      }
    } else if (!sample.pbcRequest) {
      sample.pbcStatus = "Not Required";
    }
    return sample;
  });

  function samplesFromStateSelection() {
    return defaultSamples.some((sample) => sample.id === persistedState.selectedSampleId)
      ? persistedState.selectedSampleId
      : DEFAULT_SAMPLE_ID;
  }

  const appState = {
    version: 5,
    selectedSampleId: samplesFromStateSelection(),
    activeFilter: "All",
    searchTerm: "",
    pbcEditing: false,
    workpaperEditing: false,
    samples: defaultSamples
  };
  const samples = appState.samples;

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
      LEGACY_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
    } catch (error) {
      console.warn("Workbench state could not be saved.", error);
      showToast("Changes could not be saved in this browser.", "error");
    }
  }

  function getSelectedSample() {
    return samples.find((sample) => sample.id === appState.selectedSampleId) || null;
  }

  function activityTimestamp() {
    return new Date().toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  }

  function addActivity(sample, action, detail = "") {
    sample.activityLog.unshift({ id: `ACT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, action, detail, timestamp: activityTimestamp() });
    sample.activityLog = sample.activityLog.slice(0, 100);
  }

  function assertionResults(sample) {
    const impacted = new Set();
    if (sample.risk.mismatch) impacted.add("Accuracy");
    if (sample.risk.recognizedBeforeShipment) impacted.add("Cutoff");
    if (sample.evidence.invoice.status !== "Reviewed") ["Occurrence", "Accuracy"].forEach((item) => impacted.add(item));
    if (sample.evidence.salesContract.status !== "Reviewed") impacted.add("Occurrence");
    if (sample.evidence.shippingDocument.status !== "Reviewed") ["Cutoff", "Occurrence"].forEach((item) => impacted.add(item));
    if (sample.evidence.cashReceipt.status !== "Reviewed" || sample.risk.delayedCash) impacted.add("Collectibility");
    if (sample.evidence.glDetail.status !== "Reviewed") impacted.add("Accuracy");
    if (sample.risk.roundDollar) ["Occurrence", "Accuracy"].forEach((item) => impacted.add(item));
    if (sample.exceptionDecision === "Exception Noted" && !impacted.size) impacted.add("Occurrence");

    return ["Occurrence", "Accuracy", "Cutoff", "Existence", "Valuation", "Collectibility"].map((name) => ({
      name,
      status: impacted.has(name) ? "Affected" : "No exception noted"
    }));
  }

  function auditOutcome(sample) {
    const assertions = assertionResults(sample).filter((assertion) => assertion.status === "Affected").map((assertion) => assertion.name);
    const decision = sample.exceptionDecision || "Not Assessed";
    const hasException = decision === "Exception Noted";
    const needsFollowUp = decision === "Follow-up Required";
    const followUp = sample.risk.incomplete.length
      ? `Complete review of ${sample.risk.incomplete.join(", ")} and reperform the relevant procedures.`
      : sample.risk.recognizedBeforeShipment
        ? "Inspect shipping terms and evaluate whether the revenue entry requires a cutoff adjustment."
        : sample.risk.mismatch
          ? "Reconcile the invoice to the ledger and investigate the posting difference."
          : sample.risk.delayedCash
            ? "Evaluate collectibility and inspect subsequent cash receipt support."
            : "No additional follow-up is required based on the procedures performed.";

    let conclusion = "Exception evaluation has not been completed. Select an auditor disposition before routing this sample for review.";
    if (decision === "No Exception Noted") conclusion = "No exception was noted after evaluating the risk indicators, management explanation, and evidence obtained. The transaction is supported for the assertions tested.";
    else if (needsFollowUp) conclusion = "The sample remains open because additional evidence or audit procedures are required before a conclusion can be reached.";
    else if (hasException && sample.risk.level === "High") conclusion = "A significant exception was identified. Escalate to the senior and evaluate the need for a proposed adjustment or expanded testing.";
    else if (hasException) conclusion = "An exception was identified and documented. Evaluate its disposition, potential misstatement impact, and effect on further procedures.";

    return {
      exceptionStatus: decision,
      assertions: assertions.length ? assertions : ["None"],
      followUp: needsFollowUp ? followUp : decision === "No Exception Noted" ? "No additional follow-up is required based on the auditor's recorded disposition." : followUp,
      conclusion
    };
  }

  function managerReviewSummary(sample) {
    const open = sample.managerComments.filter((comment) => !comment.resolved);
    const resolved = sample.managerComments.filter((comment) => comment.resolved);
    let status = "Not ready for review";
    if (sample.taskStatus === "Reviewed") status = "Review complete";
    else if (open.length) status = "Review points open";
    else if (sample.taskStatus === "Ready for Manager Review" || sample.workingPaperStatus === "Ready for Manager Review") status = "Ready for manager review";

    let conclusion = "Complete the associate procedures and route the sample for review.";
    if (open.length) conclusion = "Address all open review comments before final manager sign-off.";
    else if (sample.taskStatus === "Reviewed") conclusion = "Manager review is complete; no open review points remain.";
    else if (sample.taskStatus === "Ready for Manager Review") conclusion = sample.risk.findings.length
      ? "Review the documented exception, assertion impact, and proposed resolution before sign-off."
      : "The sample is ready for manager review and sign-off."

    return { status, open, resolved, conclusion };
  }

  function pbcRequirements(sample) {
    const requirements = Object.values(sample.evidence)
      .filter((item) => ["Not Received", "Exception"].includes(item.status))
      .map((item) => `${item.label} (${item.ref}) for invoice ${sample.invoiceNumber}${item.status === "Exception" ? " and an explanation of the evidence exception" : ""}`);
    if (sample.risk.mismatch) requirements.push(`Invoice-to-GL reconciliation and management explanation for the ${signedCurrency(sample.risk.difference)} difference`);
    if (sample.risk.recognizedBeforeShipment) requirements.push("Shipping terms, proof of delivery, and management's revenue cutoff analysis");
    if (sample.risk.delayedCash) requirements.push(`Subsequent cash receipt support and collectibility explanation (${sample.risk.cashDays} days after recognition)`);
    if (sample.exceptionDecision === "Follow-up Required") requirements.push("Management's written response to the open audit follow-up and proposed resolution");
    return requirements;
  }

  function reviewReadiness(sample) {
    const pbcRequired = pbcRequirements(sample).length > 0;
    const evidenceComplete = Object.values(sample.evidence).every((item) => item.status === "Reviewed" || item.tickmark === "N/A Not applicable");
    const items = [
      { key: "started", label: "Review started", state: sample.taskStatus === "Not Started" ? "Missing" : "Completed" },
      { key: "evidence", label: "Evidence review completed", state: evidenceComplete ? "Completed" : "Missing" },
      { key: "exception", label: "Exception decision completed", state: sample.exceptionDecision === "Not Assessed" ? "Missing" : "Completed" },
      { key: "notes", label: "Audit note saved", state: sample.auditNotes.length ? "Completed" : "Missing" },
      { key: "pbc", label: "PBC request addressed if required", state: pbcRequired ? (sample.pbcAddressed && ["Received", "Not Required"].includes(sample.pbcStatus) ? "Completed" : "Missing") : "Not applicable" },
      { key: "generated", label: "Working paper generated", state: sample.workingPaperDraft ? "Completed" : "Missing" },
      { key: "saved", label: "Working paper saved", state: sample.workingPaperSaved && !sample.workingPaperStale ? "Completed" : "Missing" }
    ];
    return { items, ready: items.every((item) => item.state !== "Missing"), missing: items.filter((item) => item.state === "Missing"), pbcRequired };
  }

  function currentTask(sample) {
    const readiness = reviewReadiness(sample);
    const missingEvidence = Object.values(sample.evidence).filter((item) => item.status === "Not Received");
    if (sample.taskStatus === "Reviewed") return { title: `Review complete for ${sample.id}`, recommendation: "No further action is required unless the sample is reopened.", target: "managerReviewPanel" };
    if (sample.taskStatus === "Not Started") return { title: `Start review for ${sample.id}`, recommendation: "Click Start Review to begin the audit procedure.", action: "start", target: "sampleDetail" };
    if (missingEvidence.length && !sample.pbcAddressed) return { title: "Missing evidence follow-up", recommendation: `Generate and send a PBC request for ${missingEvidence.map((item) => item.label.toLowerCase()).join(", ")}.`, target: "pbcRequestPanel" };
    if (!readiness.items.find((item) => item.key === "evidence" && item.state === "Completed")) return { title: "Complete evidence review", recommendation: "Review each evidence item, assign a tickmark, and document any follow-up note.", target: "evidenceList" };
    if (sample.exceptionDecision === "Not Assessed") return { title: "Exception decision", recommendation: "Evaluate the risk indicators and record the auditor disposition.", target: "exceptionDecisionActions" };
    if (!sample.auditNotes.length) return { title: "Document audit procedures", recommendation: "Save an audit note describing the work performed and conclusion reached.", target: "auditNotesInput" };
    if (readiness.pbcRequired && !sample.pbcAddressed) return { title: "Address client follow-up", recommendation: sample.pbcStatus === "Sent" ? "Monitor the PBC request and mark it received when support arrives." : "Generate and complete the required PBC request.", target: "pbcRequestPanel" };
    if (!sample.workingPaperDraft) return { title: "Working paper preparation", recommendation: "Generate the selected sample working paper draft.", action: "generate", target: "working-paper" };
    if (!sample.workingPaperSaved || sample.workingPaperStale) return { title: "Save working paper", recommendation: "Review the draft, resolve stale content, and save the working paper.", target: "workingPaperEditorPanel" };
    if (sample.taskStatus !== "Ready for Manager Review") return { title: "Manager review readiness", recommendation: "All preparer checks are complete. Submit the sample for manager review.", action: "submit", target: "readinessPanel" };
    if (managerReviewSummary(sample).open.length) return { title: "Clear manager review points", recommendation: "Document associate responses and resolve each open manager comment.", target: "managerReviewPanel" };
    return { title: "Manager sign-off", recommendation: "The sample is ready for final manager review and sign-off.", target: "managerReviewPanel" };
  }

  function buildPbcText(sample) {
    const requirements = pbcRequirements(sample);
    if (!requirements.length) return "No additional client support is required for this sample.";
    return `PBC REQUEST — REVENUE SAMPLE ${sample.id}\n\nClient: ${engagement.client}\nCustomer: ${sample.customer}\nInvoice: ${sample.invoiceNumber}\nAmount: ${currency(sample.invoiceAmount)}\nRequested by: ${engagement.preparer.name}, ${engagement.preparer.role}\n\nPlease provide the following support:\n${requirements.map((item, index) => `${index + 1}. ${item}`).join("\n")}\n\nPurpose: To complete revenue test-of-details procedures over occurrence, accuracy, cutoff, and collectibility. Please provide support that agrees to the transaction above and includes all relevant dates and terms.\n\nThank you.`;
  }

  function buildWorkingPaperText(sample) {
    const outcome = auditOutcome(sample);
    const manager = managerReviewSummary(sample);
    const evidenceReviewed = Object.values(sample.evidence)
      .map((item) => `- ${item.label} (${item.ref}): ${item.status} | Tickmark: ${item.tickmark}${item.note ? ` | Note: ${item.note}` : ""}`)
      .join("\n");
    const evidenceReferences = Object.values(sample.evidence).map((item) => `- ${item.ref} — ${item.label} — ${item.status} — ${item.tickmark}`).join("\n");
    const reviewedRefs = Object.values(sample.evidence).filter((item) => item.status === "Reviewed").map((item) => `${item.label} ${item.ref}`);
    const missingRefs = Object.values(sample.evidence).filter((item) => item.status === "Not Received").map((item) => `${item.label} ${item.ref}`);
    const exceptionRefs = Object.values(sample.evidence).filter((item) => item.status === "Exception").map((item) => `${item.label} ${item.ref}`);
    const evidenceProcedure = [
      reviewedRefs.length ? `Inspected and cross-referenced ${reviewedRefs.join(", ")}.` : "No evidence item is currently documented as reviewed.",
      missingRefs.length ? `${missingRefs.join(", ")} ${missingRefs.length === 1 ? "was" : "were"} not provided as of the review date and no successful inspection is asserted.` : "No required evidence is currently marked Not Received.",
      exceptionRefs.length ? `${exceptionRefs.join(", ")} ${exceptionRefs.length === 1 ? "contains" : "contain"} an evidence exception requiring disposition.` : "No evidence item is currently marked Exception."
    ].join(" ");
    const exceptions = sample.risk.findings.length
      ? sample.risk.findings.map((finding) => `- ${finding}`).join("\n")
      : "- No exceptions noted.";
    const notes = sample.auditNotes.length ? sample.auditNotes.map((note) => `- ${note.timestamp}: ${note.text}`).join("\n") : "No associate notes documented.";
    const reviewComments = sample.managerComments.length
      ? sample.managerComments.map((comment) => `- ${comment.resolved ? "Resolved" : "Open"}: ${comment.text}${comment.response ? ` | Associate response: ${comment.response}` : ""}`).join("\n")
      : "- No manager review comments.";

    return `AUDIT EVIDENCE COPILOT — REVENUE TEST OF DETAILS\nSample ${sample.id} | ${sample.customer}\nPrepared ${today()}\n\nOBJECTIVE\nTo test the occurrence, accuracy, cutoff, and collectibility of the selected revenue transaction.\n\nPROCEDURE PERFORMED\nSelected invoice ${sample.invoiceNumber} for ${currency(sample.invoiceAmount)} and compared the recorded GL amount of ${currency(sample.glAmount)} to source documentation. Compared the revenue date (${formatDate(sample.revenueDate)}) with shipment (${formatDate(sample.shippingDate)}) and evaluated the subsequent receipt dated ${formatDate(sample.cashReceiptDate)}. ${evidenceProcedure}\n\nEVIDENCE REVIEWED\n${evidenceReviewed}\n\nEVIDENCE REFERENCES\n${evidenceReferences}\n\nEXCEPTIONS NOTED\n${exceptions}\nAuditor disposition: ${sample.exceptionDecision}\nRisk assessment: ${sample.risk.score}/100 — ${sample.risk.level}\n\nASSERTION IMPACT\n${outcome.assertions.join(", ")}\n\nMANAGEMENT EXPLANATION\n${sample.managementExplanation || "No management explanation documented."}\n\nPROPOSED RESOLUTION\n${sample.proposedResolution || "No proposed resolution documented."}\n\nAUDIT NOTES\n${notes}\n\nPBC STATUS\n${sample.pbcStatus}${pbcRequirements(sample).length ? ` — Requested items: ${pbcRequirements(sample).join("; ")}` : ""}\n\nAUDIT CONCLUSION\n${outcome.conclusion}\nFollow-up: ${outcome.followUp}\n\nPREPARED BY\n${engagement.preparer.name} · ${engagement.preparer.role} — ${today()}\n\nREVIEWED BY\n${engagement.reviewer.name} · ${engagement.reviewer.role} — ${sample.taskStatus === "Reviewed" ? today() : "Pending"}\n\nREVIEW STATUS\n${manager.status}\nOpen comments: ${manager.open.length} | Resolved comments: ${manager.resolved.length}\n\nMANAGER REVIEW POINTS\n${reviewComments}`;
  }

  function refreshGeneratedArtifacts(sample) {
    sample.risk = assessRisk(sample);
    if (pbcRequirements(sample).length) {
      if (sample.pbcRequest && sample.pbcStatus === "Drafted") {
        sample.pbcRequest = buildPbcText(sample);
      }
    } else {
      if (!sample.pbcRequest || !["Sent", "Received"].includes(sample.pbcStatus)) {
        sample.pbcStatus = "Not Required";
        sample.pbcRequest = "";
      }
    }
    syncWorkingPaperSource(sample);
  }

  function syncWorkingPaperSource(sample) {
    if (!sample.workingPaperDraft) return;
    sample.workingPaperStatus = "Draft";
    sample.workingPaperSaved = false;
    if (sample.workingPaperCustomized) sample.workingPaperStale = true;
    else {
      sample.workingPaperDraft = buildWorkingPaperText(sample);
      sample.workingPaperStale = false;
    }
  }

  function showToast(message, type = "success") {
    const toast = byId("toast");
    if (!toast) return;
    const messageNode = toast.querySelector("span");
    if (messageNode) messageNode.textContent = message;
    toast.className = `toast show ${type}`;
    window.clearTimeout(showToast.timeout);
    showToast.timeout = window.setTimeout(() => { toast.className = "toast"; }, 2600);
  }

  function renderDashboard() {
    const high = samples.filter((sample) => sample.risk.level === "High").length;
    const medium = samples.filter((sample) => sample.risk.level === "Medium").length;
    const low = samples.filter((sample) => sample.risk.level === "Low").length;
    const missing = samples.reduce((total, sample) => total + sample.risk.missing.length, 0);
    const reviewed = samples.filter((sample) => sample.taskStatus === "Reviewed").length;
    const ready = samples.filter((sample) => sample.taskStatus === "Ready for Manager Review").length;
    const notStarted = samples.filter((sample) => sample.taskStatus === "Not Started").length;
    const inProgress = samples.filter((sample) => sample.taskStatus === "In Progress").length;
    const active = samples.filter((sample) => ["Not Started", "In Progress"].includes(sample.taskStatus)).length;
    const followUp = samples.filter((sample) => ["Waiting for Client", "Exception Noted"].includes(sample.taskStatus)).length;
    const openPbc = samples.filter((sample) => ["Drafted", "Sent"].includes(sample.pbcStatus)).length;
    const completion = Math.round(((reviewed + ready) / samples.length) * 100);

    const testedValue = samples.reduce((total, sample) => total + sample.invoiceAmount, 0);
    byId("metricGrid").innerHTML = [
      ["#1769d2", "#eaf2fc", "Total samples", samples.length, `${currency(testedValue)} selected`],
      ["#187452", "#e7f5ef", "Completed samples", reviewed, `${Math.round((reviewed / samples.length) * 100)}% completed`],
      ["#b7373f", "#fcebed", "High-risk samples", high, `${samples.filter((sample) => sample.exceptionDecision === "Exception Noted").length} documented exceptions`],
      ["#9a5d0b", "#fff2dc", "Missing evidence", missing, `${samples.filter((sample) => sample.risk.missing.length).length} samples affected`],
      ["#9a5d0b", "#fff2dc", "Open PBC requests", openPbc, "Drafted or sent"],
      ["#1769d2", "#eaf2fc", "Ready for manager review", ready, `${reviewed} already reviewed`]
    ].map(([color, pale, label, value, detail]) => `<article class="panel metric-card" style="--metric-color:${color};--metric-pale:${pale}"><div class="metric-top"><span class="metric-label">${label}</span><span class="metric-icon">●</span></div><strong>${value}</strong><p>${detail}</p></article>`).join("");
    byId("progressPercent").textContent = `${completion}%`;
    byId("progressBar").style.width = `${completion}%`;
    byId("progressBar").parentElement.setAttribute("aria-valuenow", completion);
    byId("progressLegend").innerHTML = [
      ["#187452", "Reviewed", reviewed], ["#1769d2", "Ready", ready], ["#8a96a6", "Active", active], ["#b7373f", "Follow-up", followUp]
    ].map(([color, label, value]) => `<span class="legend-item"><i class="legend-dot" style="background:${color}"></i><span>${label} <b>${value}</b></span></span>`).join("");
    byId("riskBars").innerHTML = [["High", high, "#b7373f"], ["Medium", medium, "#d28a20"], ["Low", low, "#187452"]].map(([label, value, color]) => `<div class="risk-bar-row"><span>${label}</span><span class="mini-bar"><i style="width:${(value / samples.length) * 100}%;background:${color}"></i></span><b>${value}</b></div>`).join("");
    byId("highRiskButtonCount").textContent = high;
    byId("navOpenCount").textContent = samples.length - reviewed;
    byId("workflowProgress").textContent = `${reviewed + ready} of ${samples.length} ready`;
    byId("sampleCoverage").textContent = `${currency(testedValue)} · ${((testedValue / engagement.populationValue) * 100).toFixed(1)}%`;

    const filterCounts = {
      allCount: samples.length,
      notStartedFilterCount: notStarted,
      inProgressFilterCount: inProgress,
      highFilterCount: high,
      missingFilterCount: samples.filter((sample) => sample.risk.missing.length).length,
      waitingFilterCount: samples.filter((sample) => sample.taskStatus === "Waiting for Client").length,
      exceptionFilterCount: samples.filter((sample) => sample.taskStatus === "Exception Noted").length,
      readyFilterCount: ready,
      reviewedFilterCount: reviewed,
      openPbcFilterCount: openPbc
    };
    Object.entries(filterCounts).forEach(([id, value]) => { if (byId(id)) byId(id).textContent = value; });

    const queue = samples.filter((sample) => sample.exceptionDecision === "Follow-up Required" || sample.risk.findings.length || ["Waiting for Client", "Exception Noted"].includes(sample.taskStatus))
      .sort((a, b) => b.risk.score - a.risk.score)
      .slice(0, 5);
    byId("actionQueue").innerHTML = queue.length ? queue.map((sample) => `
      <button class="action-item" type="button" data-open-sample="${sample.id}">
        <span class="action-icon">!</span>
        <span><strong>${sample.id} · ${escapeHtml(sample.customer)}</strong><span>${sample.risk.missing.length ? `${sample.risk.missing.length} evidence item${sample.risk.missing.length === 1 ? "" : "s"} outstanding` : sample.risk.findings[0]}</span></span>
        <b>${sample.risk.score} ${sample.risk.level}</b>
      </button>`).join("") : '<div class="empty-queue">No follow-up items remain.</div>';
  }

  function filteredSamples() {
    const term = appState.searchTerm.trim().toLowerCase();
    return samples.filter((sample) => {
      const matchesSearch = !term || [sample.id, sample.customer, sample.invoiceNumber].some((value) => value.toLowerCase().includes(term));
      const matchesFilter = {
        All: true,
        "Not Started": sample.taskStatus === "Not Started",
        "In Progress": sample.taskStatus === "In Progress",
        "High Risk": sample.risk.level === "High",
        "Missing Evidence": sample.risk.missing.length > 0,
        "Open PBC": ["Drafted", "Sent"].includes(sample.pbcStatus),
        "Waiting for Client": sample.taskStatus === "Waiting for Client",
        "Exception Noted": sample.taskStatus === "Exception Noted",
        "Ready for Manager Review": sample.taskStatus === "Ready for Manager Review",
        Reviewed: sample.taskStatus === "Reviewed"
      }[appState.activeFilter];
      return matchesSearch && matchesFilter;
    });
  }

  function reconcileSelection(results) {
    if (!results.length) {
      appState.selectedSampleId = null;
      return;
    }
    if (!results.some((sample) => sample.id === appState.selectedSampleId)) {
      appState.selectedSampleId = results[0].id;
      appState.pbcEditing = false;
      appState.workpaperEditing = false;
    }
  }

  function renderSamplesView() {
    const results = filteredSamples();
    reconcileSelection(results);
    const body = byId("sampleTableBody");
    const empty = byId("emptyState");
    const workspace = byId("sampleDetail");

    body.innerHTML = results.map((sample) => {
      return `<tr tabindex="0" role="button" aria-label="Open ${sample.id}" data-sample-id="${sample.id}" class="${sample.id === appState.selectedSampleId ? "selected" : ""}">
        <td><span class="sample-id">${sample.id}</span></td>
        <td><strong>${escapeHtml(sample.customer)}</strong></td>
        <td>${sample.invoiceNumber}</td>
        <td class="currency">${currency(sample.invoiceAmount)}</td>
        <td class="currency ${sample.risk.mismatch ? "amount-difference" : ""}">${currency(sample.glAmount)}</td>
        <td>${formatDate(sample.revenueDate)}</td>
        <td>${formatDate(sample.shippingDate)}</td>
        <td><strong>${sample.risk.score}</strong></td>
        <td><span class="risk-badge ${sample.risk.level.toLowerCase()}">${sample.risk.level}</span></td>
        <td><span class="workflow-badge ${slug(sample.taskStatus)}">${sample.taskStatus}</span></td>
        <td><span class="workflow-badge ${slug(sample.pbcStatus)}">${sample.pbcStatus}</span></td>
      </tr>`;
    }).join("");

    empty.hidden = results.length > 0;
    workspace.hidden = results.length === 0;
    byId("tableResultCount").textContent = results.length ? `Showing ${results.length} of ${samples.length} samples` : `No samples match the current filters (0 of ${samples.length})`;
    if (results.length) renderDetail(getSelectedSample());
  }

  function renderEvidence(sample) {
    byId("evidenceList").innerHTML = Object.entries(sample.evidence).map(([key, item]) => {
      const reviewed = item.status === "Reviewed";
      return `<div class="evidence-item ${reviewed ? "available" : item.status === "Exception" ? "exception" : item.status === "Not Received" ? "missing" : "received"}">
        <span class="evidence-icon" aria-hidden="true">${reviewed ? "✓" : item.status === "Exception" ? "!" : "•"}</span>
        <span class="evidence-copy"><strong>${item.label}</strong><small>${item.ref}</small></span>
        <div class="evidence-controls">
          <label><span>Status</span><select data-evidence-key="${key}" aria-label="${item.label} status">${evidenceStatuses.map((status) => `<option value="${status}" ${status === item.status ? "selected" : ""}>${status}</option>`).join("")}</select></label>
          <label><span>Tickmark</span><select data-tickmark-key="${key}" aria-label="${item.label} tickmark">${tickmarkOptions.map((tickmark) => `<option value="${tickmark}" ${tickmark === item.tickmark ? "selected" : ""}>${tickmark}</option>`).join("")}</select></label>
          <label class="evidence-note-control"><span>Evidence note <em>optional</em></span><input type="text" data-evidence-note-key="${key}" aria-label="${item.label} evidence note" value="${escapeHtml(item.note)}" placeholder="Add a short cross-reference note"></label>
        </div>
      </div>`;
    }).join("");

    const reviewed = Object.values(sample.evidence).filter((item) => item.status === "Reviewed").length;
    byId("evidenceSummary").textContent = `Evidence Completion: ${reviewed} / 5 Reviewed`;
    byId("evidenceSummary").className = `panel-summary ${reviewed < 5 ? "warning" : "complete"}`;
    byId("evidenceCallout").className = `evidence-callout ${reviewed < 5 ? "warning" : "complete"}`;
    byId("evidenceCallout").innerHTML = reviewed < 5
      ? `<span aria-hidden="true">!</span><div><strong>${5 - reviewed} item${5 - reviewed === 1 ? "" : "s"} not reviewed</strong><p>Update each status as support is received, inspected, and concluded. Risk and downstream documentation update automatically.</p></div>`
      : '<span aria-hidden="true">✓</span><div><strong>Evidence set complete</strong><p>All required support has been received and inspected.</p></div>';
  }

  function renderTransactionAndRisk(sample) {
    const risk = sample.risk;
    byId("selectionBasis").textContent = sample.selectionBasis;
    byId("detailRiskBadge").textContent = `${risk.level} · ${risk.score}/100`;
    byId("detailRiskBadge").className = `risk-badge ${risk.level.toLowerCase()}`;
    byId("dateTimeline").innerHTML = [
      ["Revenue recognized", sample.revenueDate, risk.recognizedBeforeShipment],
      ["Goods shipped", sample.shippingDate, risk.recognizedBeforeShipment],
      ["Cash received", sample.cashReceiptDate, risk.delayedCash]
    ].map(([label, date, alert]) => `<div class="timeline-item ${alert ? "alert" : ""}"><span class="timeline-dot"></span><small>${label}</small><strong>${formatDate(date)}</strong></div>`).join("");
    byId("amountComparison").innerHTML = `<div class="amount-box"><small>Invoice amount</small><strong>${currency(sample.invoiceAmount)}</strong></div><div class="amount-box"><small>GL amount</small><strong>${currency(sample.glAmount)}</strong></div><div class="amount-box"><small>Difference</small><strong class="${risk.mismatch ? "amount-difference" : ""}">${signedCurrency(risk.difference)}</strong></div>`;
    byId("differenceEvaluation").className = `difference-evaluation ${risk.mismatch ? "exception" : ""}`;
    byId("differenceEvaluation").innerHTML = `<span>${risk.mismatch ? "Invoice does not agree to the recorded ledger amount." : "Invoice agrees to the ledger with no difference."}</span><span class="threshold-tag">CTT ${currency(engagement.postingThreshold)}</span>`;
    const riskRows = [
      ["Amount agreement", risk.mismatch, risk.mismatch ? `Invoice-to-GL difference is ${signedCurrency(risk.difference)}.` : "Invoice agrees to the GL."],
      ["Revenue cutoff", risk.recognizedBeforeShipment, risk.recognizedBeforeShipment ? "Revenue was recognized before shipment." : "Revenue recognition follows shipment."],
      ["Evidence review", risk.incomplete.length > 0, risk.incomplete.length ? `${risk.incomplete.join(", ")} not reviewed.` : "All evidence items are reviewed."],
      ["Evidence exceptions", risk.evidenceExceptions > 0, risk.evidenceExceptions ? `${risk.evidenceExceptions} evidence exception${risk.evidenceExceptions === 1 ? "" : "s"} requires disposition.` : "No evidence items are marked Exception."],
      ["Subsequent receipt", risk.delayedCash, risk.delayedCash ? `Cash was received ${risk.cashDays} days after invoice.` : `Cash was received in ${risk.cashDays} days.`]
      , ["Round-dollar transaction", risk.roundDollar, risk.roundDollar ? "Round-dollar pricing requires enhanced scrutiny for management override risk." : "Transaction amount is not a round-dollar threshold item."]
    ];
    const factorPoints = [risk.points.mismatch, risk.points.cutoff, risk.points.evidence, risk.points.evidenceExceptions, risk.points.delayedCash, risk.points.roundDollar];
    byId("riskFindings").innerHTML = riskRows.map(([label, flagged, detail], index) => `<div class="finding ${flagged ? "flag" : "clear"}"><span aria-hidden="true">${flagged ? "!" : "✓"}</span><div><strong>${label}</strong><br>${detail}</div><span class="finding-points">+${factorPoints[index]}</span></div>`).join("");
    byId("managerReviewPoint").innerHTML = `<div><strong>Preparer focus</strong>${auditOutcome(sample).followUp}</div>`;
  }

  function renderAssertions(sample) {
    const descriptions = {
      Occurrence: "Vouch recorded revenue to customer and source documentation.",
      Accuracy: "Agree invoice value to the amount recorded in the GL.",
      Cutoff: "Compare recognition and shipping dates around year-end.",
      Existence: "Inspect evidence supporting the underlying transaction.",
      Valuation: "Evaluate settlement and indicators of collectibility.",
      Collectibility: "Inspect subsequent receipt and aging of the balance."
    };
    byId("assertionMatrix").innerHTML = assertionResults(sample).map((assertion, index) => `<div class="assertion-item"><small>Procedure ${index + 1}</small><div class="assertion-item-header"><h3>${assertion.name}</h3><span class="result-badge ${assertion.status === "Affected" ? "exception" : "pass"}">${assertion.status === "Affected" ? "Exception" : "Pass"}</span></div><p>${descriptions[assertion.name]}</p></div>`).join("");
  }

  function renderAuditOutcome(sample) {
    const outcome = auditOutcome(sample);
    byId("outcomeStatusBadge").textContent = outcome.exceptionStatus;
    byId("outcomeStatusBadge").className = `workflow-badge ${slug(outcome.exceptionStatus)}`;
    byId("auditOutcomeGrid").innerHTML = [
      ["Risk score", `${sample.risk.score}/100`, sample.risk.level],
      ["Risk level", sample.risk.level, "Rules-based triage"],
      ["Exception status", outcome.exceptionStatus, `${sample.risk.findings.length} finding${sample.risk.findings.length === 1 ? "" : "s"}`],
      ["Assertions affected", outcome.assertions.join(", "), "Financial statement impact"],
      ["Follow-up required", sample.risk.findings.length ? "Yes" : "No", outcome.followUp]
    ].map(([label, value, detail]) => `<div class="outcome-item"><small>${label}</small><strong>${value}</strong><span>${detail}</span></div>`).join("");
    byId("auditConclusion").innerHTML = `<strong>Audit conclusion</strong><br>${outcome.conclusion}`;
  }

  function renderExceptionDecision(sample) {
    const decision = sample.exceptionDecision || "Not Assessed";
    byId("exceptionDecisionBadge").textContent = decision;
    byId("exceptionDecisionBadge").className = `workflow-badge ${slug(decision)}`;
    byId("exceptionDecisionActions").querySelectorAll("[data-exception-decision]").forEach((button) => {
      button.classList.toggle("active", button.dataset.exceptionDecision === decision);
    });
    const guidance = {
      "No Exception Noted": "The associate concluded that identified indicators were resolved and no exception remains.",
      "Exception Noted": "The exception is documented and should be evaluated for misstatement impact and further procedures.",
      "Follow-up Required": "Additional evidence or audit procedures remain outstanding before the sample can be concluded.",
      "Not Assessed": "Select a disposition to complete the exception evaluation."
    };
    byId("exceptionDecisionGuidance").textContent = guidance[decision];
    byId("managementExplanation").value = sample.managementExplanation;
    byId("proposedResolution").value = sample.proposedResolution;
    byId("assessmentSaveState").textContent = sample.managementExplanation || sample.proposedResolution ? "Saved locally" : "Not saved";
  }

  function renderExceptionImpact(sample) {
    const outcome = auditOutcome(sample);
    const dollarImpact = sample.risk.mismatch ? Math.abs(sample.risk.difference) : sample.risk.findings.length ? sample.invoiceAmount : 0;
    const exceptionType = sample.risk.findings.length ? sample.risk.findings.join("; ") : "No automated exception flags";
    const aboveCtt = dollarImpact > engagement.postingThreshold;
    const abovePm = dollarImpact > engagement.performanceMateriality;
    const followUp = sample.exceptionDecision === "Follow-up Required" || sample.risk.incomplete.length > 0;
    byId("impactAssessmentBadge").textContent = sample.exceptionDecision;
    byId("impactAssessmentBadge").className = `workflow-badge ${slug(sample.exceptionDecision)}`;
    byId("exceptionImpactGrid").innerHTML = [
      ["Exception type", exceptionType],
      ["Assertions affected", outcome.assertions.join(", ")],
      ["Dollar impact", currency(dollarImpact)],
      ["Above clearly trivial?", aboveCtt ? "Yes" : "No"],
      ["Above performance materiality?", abovePm ? "Yes" : "No"],
      ["Follow-up required?", followUp ? "Yes" : "No"],
      ["Proposed resolution", sample.proposedResolution || "Not documented"]
    ].map(([label, value]) => `<div><small>${label}</small><strong>${escapeHtml(value)}</strong></div>`).join("");
    byId("impactConclusion").innerHTML = `<strong>Audit conclusion</strong><br>${outcome.conclusion}`;
  }

  function renderWorkflowProgress(sample) {
    const requirements = pbcRequirements(sample);
    const complete = {
      select: true,
      evidence: sample.taskStatus !== "Not Started" && reviewReadiness(sample).items.find((item) => item.key === "evidence").state === "Completed",
      exception: sample.exceptionDecision !== "Not Assessed",
      pbc: !requirements.length || (sample.pbcAddressed && ["Received", "Not Required"].includes(sample.pbcStatus)),
      workpaper: Boolean(sample.workingPaperDraft && sample.workingPaperSaved && !sample.workingPaperStale),
      manager: sample.taskStatus === "Reviewed"
    };
    const order = ["select", "evidence", "exception", "pbc", "workpaper", "manager"];
    const active = order.find((step) => !complete[step]) || "manager";
    document.querySelectorAll("[data-workflow-step]").forEach((item) => {
      const step = item.dataset.workflowStep;
      item.classList.toggle("complete", complete[step]);
      item.classList.toggle("active", step === active && !complete[step]);
      const index = order.indexOf(step);
      const activeIndex = order.indexOf(active);
      const blocked = index > activeIndex && !complete[step];
      item.classList.toggle("blocked", blocked);
      const status = item.querySelector("[data-step-status]");
      if (status) status.textContent = complete[step] ? "Completed" : step === active ? "Current" : blocked ? "Blocked" : "Not Started";
    });
  }

  function renderReadiness(sample) {
    const readiness = reviewReadiness(sample);
    byId("readinessBadge").textContent = readiness.ready ? "Ready" : `${readiness.missing.length} Missing`;
    byId("readinessBadge").className = `workflow-badge ${readiness.ready ? "reviewed" : "follow-up-required"}`;
    byId("readinessList").innerHTML = readiness.items.map((item) => `<div class="readiness-item ${slug(item.state)}"><span aria-hidden="true">${item.state === "Completed" ? "✓" : item.state === "Not applicable" ? "—" : "!"}</span><strong>${item.label}</strong><em>${item.state}</em></div>`).join("");
    byId("readinessMessage").textContent = readiness.ready
      ? "All required preparer checks are complete. The sample can be routed for manager review."
      : `Complete ${readiness.missing.map((item) => item.label.toLowerCase()).join(", ")} before submission.`;
  }

  function renderCurrentTask(sample) {
    const task = currentTask(sample);
    byId("currentTaskTitle").textContent = task.title;
    byId("currentTaskRecommendation").textContent = `Recommended Next Action: ${task.recommendation}`;
    byId("currentTaskAction").dataset.target = task.target || "sampleDetail";
    byId("currentTaskAction").dataset.action = task.action || "";
    byId("currentTaskAction").textContent = task.action === "start" ? "Start Review" : task.action === "generate" ? "Generate Draft" : task.action === "submit" ? "Submit for Review" : "Go to Task";
  }

  function renderSavedNotes(sample) {
    byId("savedNotesList").innerHTML = sample.auditNotes.length
      ? sample.auditNotes.map((note) => `<article class="saved-note"><div><strong>Associate note</strong><small>${escapeHtml(note.timestamp)}</small></div><p>${escapeHtml(note.text)}</p></article>`).join("")
      : '<div class="review-empty">No saved audit notes.</div>';
  }

  function renderActivityLog(sample) {
    byId("activityCount").textContent = `${sample.activityLog.length} action${sample.activityLog.length === 1 ? "" : "s"}`;
    byId("activityLog").innerHTML = sample.activityLog.length
      ? sample.activityLog.map((entry) => `<div class="activity-entry"><span class="activity-marker"></span><div><strong>${escapeHtml(entry.action)}</strong>${entry.detail ? `<p>${escapeHtml(entry.detail)}</p>` : ""}<small>${escapeHtml(entry.timestamp)}</small></div></div>`).join("")
      : '<div class="activity-empty">No activity has been recorded for this sample. Start the review to begin the audit trail.</div>';
  }

  function renderPbc(sample) {
    const required = pbcRequirements(sample).length > 0;
    byId("pbcRequestId").textContent = sample.id;
    byId("pbcRequestCustomer").textContent = sample.customer;
    byId("pbcStatusBadge").textContent = sample.pbcStatus;
    byId("pbcStatusBadge").className = `workflow-badge ${slug(sample.pbcStatus)}`;
    byId("pbcRequestText").value = sample.pbcRequest;
    byId("pbcRequestText").placeholder = required ? "Generate or edit the client request here." : "No additional client support is required.";
    byId("pbcRequestText").disabled = !required || !appState.pbcEditing;
    byId("generatePbcButton").disabled = !required;
    byId("editPbcButton").disabled = !required || !sample.pbcRequest;
    byId("editPbcButton").textContent = appState.pbcEditing ? "Finish Editing" : "Edit PBC Request";
    byId("copyPbcButton").disabled = !sample.pbcRequest;
    byId("markPbcSentButton").disabled = !sample.pbcRequest || ["Sent", "Received"].includes(sample.pbcStatus);
    byId("markPbcReceivedButton").disabled = sample.pbcStatus !== "Sent";
    byId("markPbcNotRequiredButton").disabled = required && sample.pbcStatus === "Sent";
  }

  function renderWorkingPaperEditor(sample) {
    byId("workpaperEditorTitle").textContent = `${sample.id} · ${sample.customer}`;
    byId("workpaperEditorMeta").textContent = `${sample.invoiceNumber} · ${currency(sample.invoiceAmount)} · ${sample.risk.score}/100 ${sample.risk.level} risk`;
    byId("workpaperStatusBadge").textContent = sample.workingPaperStatus;
    byId("workpaperStatusBadge").className = `workflow-badge ${slug(sample.workingPaperStatus)}`;
    byId("workingPaperEditor").value = sample.workingPaperDraft;
    byId("workingPaperEditor").placeholder = "Generate a working paper from the active sample, then edit the draft here.";
    byId("workingPaperEditor").disabled = !sample.workingPaperDraft || !appState.workpaperEditing;
    byId("editWorkingPaperButton").disabled = !sample.workingPaperDraft;
    byId("editWorkingPaperButton").textContent = appState.workpaperEditing ? "Editing Working Paper" : "Edit Working Paper";
    byId("saveWorkingPaperButton").disabled = !sample.workingPaperDraft || !appState.workpaperEditing;
    byId("markReadyForManagerButton").disabled = false;
    byId("exportWorkingPaperButton").disabled = !sample.workingPaperDraft;
    byId("workpaperSaveState").textContent = sample.workingPaperStale
      ? "Saved edits preserved · source data changed — regenerate to refresh"
      : sample.workingPaperSaved ? "Saved locally" : sample.workingPaperDraft ? "Draft generated · save required" : "No draft generated";
  }

  function renderManagerReview(sample) {
    const manager = managerReviewSummary(sample);
    byId("managerReviewStatus").textContent = manager.status;
    byId("managerOpenCount").textContent = manager.open.length;
    byId("managerResolvedCount").textContent = manager.resolved.length;
    byId("managerConclusion").textContent = manager.conclusion;
    byId("managerReviewComments").innerHTML = sample.managerComments.length
      ? sample.managerComments.slice().reverse().map((comment) => `<div class="review-comment ${comment.resolved ? "resolved" : "open"}"><div class="review-comment-copy"><div class="review-comment-heading"><strong>${comment.resolved ? "Resolved review point" : "Open review point"}</strong><span class="workflow-badge ${comment.resolved ? "reviewed" : "exception-noted"}">${comment.resolved ? "Resolved" : "Open"}</span></div><p>${escapeHtml(comment.text)}</p><small>${escapeHtml(comment.createdAt)}</small>${comment.resolved ? `<div class="associate-response"><b>Associate response</b><p>${escapeHtml(comment.response || "No response documented.")}</p></div>` : `<label for="response-${comment.id}">Associate response</label><textarea id="response-${comment.id}" data-comment-response="${comment.id}" rows="3" placeholder="Document how the review point was addressed…">${escapeHtml(comment.response || "")}</textarea><div class="comment-actions"><button class="secondary-button" type="button" data-save-response="${comment.id}">Save Response</button><button class="primary-button" type="button" data-resolve-comment="${comment.id}">Resolve Comment</button></div>`}</div></div>`).join("")
      : '<div class="review-empty">No manager review comments have been added.</div>';
  }

  function renderDetail(sample) {
    if (!sample) return;
    byId("detailTitle").textContent = `${sample.id} · ${sample.customer}`;
    byId("detailSubtitle").textContent = `${sample.invoiceNumber} · ${currency(sample.invoiceAmount)}`;
    byId("currentReviewStatus").textContent = sample.taskStatus;
    byId("currentReviewStatus").className = `workflow-badge ${slug(sample.taskStatus)}`;
    byId("reviewActionBar").querySelectorAll("[data-status]").forEach((button) => {
      button.classList.toggle("active", button.dataset.status === sample.taskStatus);
    });
    byId("auditNotesInput").value = sample.draftAuditNote;
    byId("noteSaveState").textContent = sample.auditNotes.length ? `${sample.auditNotes.length} saved note${sample.auditNotes.length === 1 ? "" : "s"}` : "No saved notes";
    byId("managerCommentComposer").hidden = true;
    byId("managerCommentInput").value = "";
    renderEvidence(sample);
    renderTransactionAndRisk(sample);
    renderAssertions(sample);
    renderExceptionDecision(sample);
    renderExceptionImpact(sample);
    renderAuditOutcome(sample);
    renderSavedNotes(sample);
    renderPbc(sample);
    renderWorkingPaperEditor(sample);
    renderManagerReview(sample);
    renderActivityLog(sample);
    renderWorkflowProgress(sample);
    renderReadiness(sample);
    renderCurrentTask(sample);
  }

  function renderAll() {
    renderDashboard();
    renderSamplesView();
  }

  function updateReviewStatus(status) {
    const sample = getSelectedSample();
    if (!sample) return;
    if (status === "Ready for Manager Review") return markReadyForManager();
    if (status === "Reviewed") {
      const manager = managerReviewSummary(sample);
      if (sample.taskStatus !== "Ready for Manager Review") {
        showToast("Submit the sample for manager review before sign-off.", "error");
        return;
      }
      if (manager.open.length) {
        showToast("Resolve open manager comments before sign-off.", "error");
        return;
      }
    }
    sample.taskStatus = status;
    if (status === "Waiting for Client" && pbcRequirements(sample).length) {
      sample.pbcStatus = sample.pbcStatus === "Received" ? "Drafted" : sample.pbcStatus;
      sample.pbcAddressed = false;
    }
    addActivity(sample, status === "In Progress" ? "Review started" : `Status changed to ${status}`);
    syncWorkingPaperSource(sample);
    if (status === "Reviewed" && sample.workingPaperDraft) {
      sample.workingPaperStatus = "Reviewed";
      sample.workingPaperStale = false;
      sample.workingPaperSaved = true;
    }
    saveState();
    renderAll();
    showToast(`Review status updated to ${status}.`);
  }

  function handleEvidenceChange(event) {
    const control = event.target.closest("[data-evidence-key], [data-tickmark-key], [data-evidence-note-key]");
    if (!control) return;
    const sample = getSelectedSample();
    if (!sample) return;
    const key = control.dataset.evidenceKey || control.dataset.tickmarkKey || control.dataset.evidenceNoteKey;
    const item = sample.evidence[key];
    if (["Ready for Manager Review", "Reviewed"].includes(sample.taskStatus)) sample.taskStatus = "In Progress";

    if (control.dataset.evidenceKey) {
      const previousStatus = item.status;
      item.status = control.value;
      item.tickmark = defaultTickmark(control.value);
      if (control.value !== "Reviewed" && sample.exceptionDecision === "No Exception Noted") sample.exceptionDecision = "Follow-up Required";
      addActivity(sample, "Evidence status updated", `${evidenceLabels[key]}: ${previousStatus} → ${control.value}`);
      refreshGeneratedArtifacts(sample);
      if (["Not Received", "Exception"].includes(control.value)) sample.pbcAddressed = false;
      showToast(`${evidenceLabels[key]} marked ${control.value.toLowerCase()}.`);
    } else if (control.dataset.tickmarkKey) {
      const previousTickmark = item.tickmark;
      item.tickmark = control.value;
      addActivity(sample, "Evidence tickmark updated", `${evidenceLabels[key]}: ${previousTickmark} → ${control.value}`);
      syncWorkingPaperSource(sample);
      showToast(`${evidenceLabels[key]} tickmark updated.`);
    } else {
      const nextNote = control.value.trim();
      if (nextNote === item.note) return;
      item.note = nextNote;
      addActivity(sample, "Evidence note updated", `${evidenceLabels[key]}: ${nextNote || "Note cleared"}`);
      syncWorkingPaperSource(sample);
      showToast(`${evidenceLabels[key]} evidence note saved.`);
    }
    saveState();
    renderAll();
  }

  function saveAuditNote() {
    const sample = getSelectedSample();
    if (!sample) return;
    const text = byId("auditNotesInput").value.trim();
    if (!text) {
      showToast("Enter an audit note before saving.", "error");
      return;
    }
    sample.auditNotes.push({ id: `NOTE-${Date.now()}`, text, timestamp: activityTimestamp() });
    sample.draftAuditNote = "";
    byId("auditNotesInput").value = "";
    addActivity(sample, "Audit note saved", text.slice(0, 120));
    syncWorkingPaperSource(sample);
    saveState();
    renderAll();
    showToast("Audit note saved.");
  }

  function clearAuditNote() {
    const sample = getSelectedSample();
    if (!sample) return;
    sample.draftAuditNote = "";
    byId("auditNotesInput").value = "";
    saveState();
    showToast("Draft note cleared. Saved notes were retained.");
  }

  function generatePbcRequest() {
    const sample = getSelectedSample();
    if (!sample || !pbcRequirements(sample).length) {
      showToast("No PBC request is required for this sample.", "error");
      return;
    }
    sample.pbcRequest = buildPbcText(sample);
    sample.pbcStatus = "Drafted";
    sample.pbcAddressed = false;
    appState.pbcEditing = true;
    addActivity(sample, "PBC request generated", `${pbcRequirements(sample).length} requested item${pbcRequirements(sample).length === 1 ? "" : "s"}`);
    syncWorkingPaperSource(sample);
    saveState();
    renderAll();
    showToast("PBC request generated.");
  }

  async function copyText(value) {
    try {
      await navigator.clipboard.writeText(value);
    } catch (error) {
      const fallback = document.createElement("textarea");
      fallback.value = value;
      fallback.style.position = "fixed";
      fallback.style.opacity = "0";
      document.body.appendChild(fallback);
      fallback.select();
      document.execCommand("copy");
      fallback.remove();
    }
  }

  async function copyPbcRequest() {
    const sample = getSelectedSample();
    if (!sample?.pbcRequest) return;
    await copyText(sample.pbcRequest);
    addActivity(sample, "PBC request copied");
    saveState();
    renderActivityLog(sample);
    showToast("PBC request copied to clipboard.");
  }

  function updatePbcStatus(status) {
    const sample = getSelectedSample();
    if (!sample || !sample.pbcRequest) return;
    if (status === "Received" && sample.pbcStatus !== "Sent") {
      showToast("Mark the request sent before marking it received.", "error");
      return;
    }
    sample.pbcStatus = status;
    sample.pbcAddressed = status === "Received";
    appState.pbcEditing = false;
    if (status === "Sent") sample.taskStatus = "Waiting for Client";
    else if (sample.taskStatus === "Waiting for Client") sample.taskStatus = "In Progress";
    addActivity(sample, `PBC marked ${status.toLowerCase()}`);
    syncWorkingPaperSource(sample);
    saveState();
    renderAll();
    showToast(`PBC request marked ${status.toLowerCase()}.`);
  }

  function markPbcNotRequired() {
    const sample = getSelectedSample();
    if (!sample) return;
    sample.pbcRequest = "";
    sample.pbcStatus = "Not Required";
    sample.pbcAddressed = true;
    appState.pbcEditing = false;
    if (sample.taskStatus === "Waiting for Client") sample.taskStatus = "In Progress";
    addActivity(sample, "PBC marked not required", pbcRequirements(sample).length ? "Associate override recorded; support requirements remain visible in risk results." : "No additional client support required.");
    syncWorkingPaperSource(sample);
    saveState();
    renderAll();
    showToast("PBC status updated to not required.");
  }

  function generateWorkingPaper() {
    const sample = getSelectedSample();
    if (!sample) return;
    sample.workingPaperDraft = buildWorkingPaperText(sample);
    sample.workingPaperStatus = "Draft";
    sample.workingPaperSaved = false;
    sample.workingPaperCustomized = false;
    sample.workingPaperStale = false;
    appState.workpaperEditing = true;
    addActivity(sample, "Working paper draft generated");
    saveState();
    renderAll();
    byId("working-paper").scrollIntoView({ behavior: "smooth", block: "start" });
    showToast("Working paper draft generated.");
  }

  function saveWorkingPaper() {
    const sample = getSelectedSample();
    if (!sample) return;
    sample.workingPaperDraft = byId("workingPaperEditor").value.trim();
    sample.workingPaperStatus = sample.workingPaperDraft ? "Draft" : "Not Started";
    sample.workingPaperCustomized = Boolean(sample.workingPaperDraft);
    sample.workingPaperStale = false;
    sample.workingPaperSaved = Boolean(sample.workingPaperDraft);
    appState.workpaperEditing = false;
    addActivity(sample, "Working paper saved");
    saveState();
    renderAll();
    showToast("Working paper saved locally.");
  }

  function markReadyForManager() {
    const sample = getSelectedSample();
    if (!sample) return;
    const readiness = reviewReadiness(sample);
    if (!readiness.ready) {
      byId("readinessPanel").scrollIntoView({ behavior: "smooth", block: "center" });
      showToast("Cannot submit for manager review yet. Please complete the missing readiness items.", "error");
      renderReadiness(sample);
      return;
    }
    sample.workingPaperStatus = "Ready for Manager Review";
    sample.workingPaperCustomized = true;
    sample.workingPaperStale = false;
    sample.workingPaperSaved = true;
    appState.workpaperEditing = false;
    sample.taskStatus = "Ready for Manager Review";
    addActivity(sample, "Working paper submitted", "Ready for manager review");
    saveState();
    renderAll();
    showToast("Working paper routed for manager review.");
  }

  function addManagerComment() {
    const composer = byId("managerCommentComposer");
    composer.hidden = false;
    byId("managerCommentInput").focus();
  }

  function saveManagerComment() {
    const sample = getSelectedSample();
    const text = byId("managerCommentInput").value.trim();
    if (!sample || !text) {
      showToast("Enter a review comment before saving.", "error");
      return;
    }
    sample.managerComments.push({
      id: `MC-${Date.now()}`,
      text,
      response: "",
      responseAt: "",
      resolved: false,
      createdAt: new Date().toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
    });
    addActivity(sample, "Manager comment added", text.slice(0, 120));
    saveState();
    byId("managerCommentInput").value = "";
    byId("managerCommentComposer").hidden = true;
    renderManagerReview(sample);
    syncWorkingPaperSource(sample);
    saveState();
    renderWorkingPaperEditor(sample);
    renderActivityLog(sample);
    showToast("Manager review comment saved.");
  }

  function resolveManagerComment(commentId) {
    const sample = getSelectedSample();
    const comment = sample?.managerComments.find((item) => item.id === commentId);
    if (!comment) return;
    if (!comment.response?.trim()) {
      showToast("Save an associate response before resolving the comment.", "error");
      return;
    }
    comment.resolved = true;
    addActivity(sample, "Manager comment resolved", comment.text.slice(0, 120));
    saveState();
    renderManagerReview(sample);
    syncWorkingPaperSource(sample);
    saveState();
    renderWorkingPaperEditor(sample);
    renderActivityLog(sample);
    showToast("Manager review comment resolved.");
  }

  function saveAssociateResponse(commentId) {
    const sample = getSelectedSample();
    const comment = sample?.managerComments.find((item) => item.id === commentId);
    const field = byId("managerReviewComments").querySelector(`[data-comment-response="${commentId}"]`);
    const response = field?.value.trim() || "";
    if (!comment || !response) {
      showToast("Enter an associate response before saving.", "error");
      return;
    }
    comment.response = response;
    comment.responseAt = activityTimestamp();
    addActivity(sample, "Associate response saved", response.slice(0, 120));
    syncWorkingPaperSource(sample);
    saveState();
    renderManagerReview(sample);
    renderWorkingPaperEditor(sample);
    renderActivityLog(sample);
    showToast("Associate response saved.");
  }

  function setExceptionDecision(decision) {
    const sample = getSelectedSample();
    if (!sample) return;
    sample.exceptionDecision = decision;
    if (decision === "Follow-up Required") sample.pbcAddressed = false;
    if (decision === "Exception Noted") sample.taskStatus = "Exception Noted";
    else if (["Exception Noted", "Ready for Manager Review", "Reviewed"].includes(sample.taskStatus)) sample.taskStatus = "In Progress";
    addActivity(sample, `Exception decision: ${decision}`);
    refreshGeneratedArtifacts(sample);
    saveState();
    renderAll();
    showToast(`Exception decision updated to ${decision.toLowerCase()}.`);
  }

  function saveExceptionAssessment() {
    const sample = getSelectedSample();
    if (!sample) return;
    sample.managementExplanation = byId("managementExplanation").value.trim();
    sample.proposedResolution = byId("proposedResolution").value.trim();
    addActivity(sample, "Exception assessment saved", sample.proposedResolution || sample.managementExplanation || "Assessment saved without narrative.");
    syncWorkingPaperSource(sample);
    saveState();
    renderExceptionImpact(sample);
    renderWorkingPaperEditor(sample);
    renderActivityLog(sample);
    byId("assessmentSaveState").textContent = "Saved locally";
    showToast("Exception assessment saved.");
  }

  function updatePbcDraft() {
    const sample = getSelectedSample();
    if (!sample) return;
    sample.pbcRequest = byId("pbcRequestText").value;
    sample.pbcStatus = pbcRequirements(sample).length ? "Drafted" : "Not Required";
    sample.pbcAddressed = false;
    syncWorkingPaperSource(sample);
    saveState();
    byId("pbcStatusBadge").textContent = sample.pbcStatus;
    byId("pbcStatusBadge").className = `workflow-badge ${slug(sample.pbcStatus)}`;
    byId("copyPbcButton").disabled = !sample.pbcRequest.trim();
    byId("markPbcSentButton").disabled = !sample.pbcRequest.trim();
    byId("markPbcReceivedButton").disabled = true;
    renderWorkingPaperEditor(sample);
    renderReadiness(sample);
    renderCurrentTask(sample);
  }

  function togglePbcEditing() {
    const sample = getSelectedSample();
    if (!sample || !sample.pbcRequest) return;
    appState.pbcEditing = !appState.pbcEditing;
    if (!appState.pbcEditing) {
      addActivity(sample, "PBC request edited");
      saveState();
      renderActivityLog(sample);
    }
    renderPbc(sample);
    if (appState.pbcEditing) byId("pbcRequestText").focus();
    showToast(appState.pbcEditing ? "PBC request unlocked for editing." : "PBC request edits saved.");
  }

  function enableWorkingPaperEditing() {
    const sample = getSelectedSample();
    if (!sample?.workingPaperDraft) return;
    appState.workpaperEditing = true;
    renderWorkingPaperEditor(sample);
    byId("workingPaperEditor").focus();
    showToast("Working paper unlocked for editing.");
  }

  function openSample(sampleId) {
    const sample = samples.find((item) => item.id === sampleId);
    if (!sample) return;
    if (appState.selectedSampleId !== sampleId) addActivity(sample, "Sample selected");
    appState.selectedSampleId = sampleId;
    appState.pbcEditing = false;
    appState.workpaperEditing = false;
    saveState();
    renderSamplesView();
    byId("sampleDetail").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function resetFilters() {
    appState.activeFilter = "All";
    appState.searchTerm = "";
    byId("searchInput").value = "";
    document.querySelectorAll(".filter-button").forEach((button) => button.classList.toggle("active", button.dataset.filter === "All"));
    renderSamplesView();
  }

  function exportPopulation() {
    const headers = ["Sample ID", "Customer", "Invoice", "Invoice Amount", "GL Amount", "Recognition Date", "Shipping Date", "Cash Receipt Date", "Evidence Available", "Risk Score", "Risk Level", "Review Status"];
    const rows = samples.map((sample) => [sample.id, sample.customer, sample.invoiceNumber, sample.invoiceAmount, sample.glAmount, sample.revenueDate, sample.shippingDate, sample.cashReceiptDate, `${5 - sample.risk.incomplete.length}/5`, sample.risk.score, sample.risk.level, sample.taskStatus]);
    const csv = [headers, ...rows].map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "audit-evidence-copilot-revenue-samples.csv";
    link.click();
    URL.revokeObjectURL(url);
    showToast("Sample population exported.");
  }

  function downloadFile(contents, filename, type) {
    const url = URL.createObjectURL(new Blob([contents], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function exportWorkingPaper() {
    const sample = getSelectedSample();
    if (!sample?.workingPaperDraft) {
      showToast("Generate a working paper before exporting it.", "error");
      return;
    }
    downloadFile(sample.workingPaperDraft, `${sample.id}-revenue-working-paper.txt`, "text/plain;charset=utf-8");
    showToast("Working paper exported.");
  }

  function exportActivityLog() {
    const sample = getSelectedSample();
    if (!sample) return;
    const entries = sample.activityLog.length
      ? sample.activityLog.map((entry) => `${entry.timestamp} | ${entry.action}${entry.detail ? ` | ${entry.detail}` : ""}`).join("\n")
      : "No activity has been recorded for this sample.";
    const documentText = `AUDIT EVIDENCE COPILOT — SAMPLE ACTIVITY LOG\nSample: ${sample.id} | ${sample.customer}\nExported: ${today()}\n\n${entries}`;
    downloadFile(documentText, `${sample.id}-activity-log.txt`, "text/plain;charset=utf-8");
    showToast("Activity log exported.");
  }

  function exportSampleReviewJson() {
    const sample = getSelectedSample();
    if (!sample) return;
    downloadFile(JSON.stringify(sample, null, 2), `${sample.id}-sample-review.json`, "application/json;charset=utf-8");
    showToast("Sample review JSON exported.");
  }

  function handleCurrentTaskAction() {
    const button = byId("currentTaskAction");
    if (button.dataset.action === "start") return updateReviewStatus("In Progress");
    if (button.dataset.action === "generate") return generateWorkingPaper();
    if (button.dataset.action === "submit") return markReadyForManager();
    byId(button.dataset.target)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function bindEvents() {
    document.querySelectorAll(".nav-link[data-section]").forEach((button) => button.addEventListener("click", () => {
      document.querySelectorAll(".nav-link").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
    }));

    document.querySelectorAll(".filter-button").forEach((button) => button.addEventListener("click", () => {
      appState.activeFilter = button.dataset.filter;
      document.querySelectorAll(".filter-button").forEach((item) => item.classList.toggle("active", item === button));
      renderSamplesView();
    }));

    byId("searchInput").addEventListener("input", (event) => { appState.searchTerm = event.target.value; renderSamplesView(); });
    byId("clearFilters").addEventListener("click", resetFilters);
    byId("sampleTableBody").addEventListener("click", (event) => {
      const target = event.target.closest("[data-open-sample], tr[data-sample-id]");
      if (target) openSample(target.dataset.openSample || target.dataset.sampleId);
    });
    byId("sampleTableBody").addEventListener("keydown", (event) => {
      if (["Enter", " "].includes(event.key) && event.target.matches("tr[data-sample-id]")) {
        event.preventDefault();
        openSample(event.target.dataset.sampleId);
      }
    });
    byId("actionQueue").addEventListener("click", (event) => {
      const target = event.target.closest("[data-open-sample]");
      if (target) openSample(target.dataset.openSample);
    });
    byId("reviewActionBar").addEventListener("click", (event) => {
      const button = event.target.closest("[data-status]");
      if (button) updateReviewStatus(button.dataset.status);
    });
    byId("exceptionDecisionActions").addEventListener("click", (event) => {
      const button = event.target.closest("[data-exception-decision]");
      if (button) setExceptionDecision(button.dataset.exceptionDecision);
    });
    byId("evidenceList").addEventListener("change", handleEvidenceChange);
    byId("evidenceList").addEventListener("focusout", (event) => {
      if (event.target.matches("[data-evidence-note-key]")) handleEvidenceChange(event);
    });
    byId("saveNoteButton").addEventListener("click", saveAuditNote);
    byId("clearNoteButton").addEventListener("click", clearAuditNote);
    byId("saveAssessmentButton").addEventListener("click", saveExceptionAssessment);
    byId("generatePbcButton").addEventListener("click", generatePbcRequest);
    byId("editPbcButton").addEventListener("click", togglePbcEditing);
    byId("jumpToPbcButton").addEventListener("click", () => byId("pbcRequestPanel").scrollIntoView({ behavior: "smooth", block: "center" }));
    byId("copyPbcButton").addEventListener("click", copyPbcRequest);
    byId("markPbcSentButton").addEventListener("click", () => updatePbcStatus("Sent"));
    byId("markPbcReceivedButton").addEventListener("click", () => updatePbcStatus("Received"));
    byId("markPbcNotRequiredButton").addEventListener("click", markPbcNotRequired);
    byId("pbcRequestText").addEventListener("input", updatePbcDraft);
    ["generatePaperButton", "generateFromDetail"].forEach((id) => byId(id).addEventListener("click", generateWorkingPaper));
    byId("workingPaperEditor").addEventListener("input", () => {
      const sample = getSelectedSample();
      if (sample) sample.workingPaperSaved = false;
      byId("workpaperSaveState").textContent = "Unsaved changes";
      if (sample) renderReadiness(sample);
    });
    byId("editWorkingPaperButton").addEventListener("click", enableWorkingPaperEditing);
    byId("saveWorkingPaperButton").addEventListener("click", saveWorkingPaper);
    byId("markReadyForManagerButton").addEventListener("click", markReadyForManager);
    byId("readinessSubmitButton").addEventListener("click", markReadyForManager);
    byId("currentTaskAction").addEventListener("click", handleCurrentTaskAction);
    byId("exportWorkingPaperButton").addEventListener("click", exportWorkingPaper);
    byId("exportActivityLogButton").addEventListener("click", exportActivityLog);
    byId("exportSampleJsonButton").addEventListener("click", exportSampleReviewJson);
    byId("addManagerCommentButton").addEventListener("click", addManagerComment);
    byId("saveManagerCommentButton").addEventListener("click", saveManagerComment);
    byId("cancelManagerCommentButton").addEventListener("click", () => {
      byId("managerCommentInput").value = "";
      byId("managerCommentComposer").hidden = true;
    });
    byId("managerReviewComments").addEventListener("click", (event) => {
      const responseButton = event.target.closest("[data-save-response]");
      if (responseButton) {
        saveAssociateResponse(responseButton.dataset.saveResponse);
        return;
      }
      const button = event.target.closest("[data-resolve-comment]");
      if (button) resolveManagerComment(button.dataset.resolveComment);
    });
    byId("riskMethodButton").addEventListener("click", () => {
      const method = byId("riskMethod");
      method.hidden = !method.hidden;
      byId("riskMethodButton").setAttribute("aria-expanded", String(!method.hidden));
    });
    document.querySelectorAll("[data-jump]").forEach((button) => button.addEventListener("click", () => byId(button.dataset.jump)?.scrollIntoView({ behavior: "smooth", block: "start" })));
    byId("reviewHighRisk").addEventListener("click", () => {
      appState.activeFilter = "High Risk";
      document.querySelectorAll(".filter-button").forEach((button) => button.classList.toggle("active", button.dataset.filter === "High Risk"));
      renderSamplesView();
      byId("samples").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    byId("exportButton").addEventListener("click", exportPopulation);
    byId("menuButton").addEventListener("click", () => {
      const open = !byId("sidebar").classList.contains("open");
      byId("sidebar").classList.toggle("open", open);
      byId("sidebarScrim").classList.toggle("open", open);
      byId("menuButton").setAttribute("aria-expanded", String(open));
    });
    byId("sidebarScrim").addEventListener("click", () => {
      byId("sidebar").classList.remove("open");
      byId("sidebarScrim").classList.remove("open");
      byId("menuButton").setAttribute("aria-expanded", "false");
    });
  }

  function initialize() {
    if (!samples.some((sample) => sample.id === appState.selectedSampleId)) appState.selectedSampleId = samples[0]?.id || null;
    appState.activeFilter = "All";
    appState.searchTerm = "";
    byId("searchInput").value = "";
    bindEvents();
    renderAll();
    saveState();
  }

  document.addEventListener("DOMContentLoaded", initialize);
})();
