(function () {
  "use strict";

  const STORAGE_KEY = "audit-evidence-copilot.workbench.v2";
  const LEGACY_STORAGE_KEY = "audit-evidence-copilot.workflow.v1";
  const DEFAULT_SAMPLE_ID = "REV-001";

  const evidenceLabels = {
    invoice: "Invoice",
    salesContract: "Sales Contract",
    shippingDocument: "Shipping Document",
    cashReceipt: "Cash Receipt",
    glDetail: "GL Detail"
  };

  const evidenceIcons = {
    invoice: "receipt_long",
    salesContract: "description",
    shippingDocument: "local_shipping",
    cashReceipt: "payments",
    glDetail: "table_view"
  };

  const state = {
    selectedId: null,
    activeFilter: "All",
    searchTerm: ""
  };

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

  function loadPersistedState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      if (saved.samples && typeof saved.samples === "object") return saved.samples;

      const legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || "{}");
      return Object.fromEntries(Object.entries(legacy).map(([id, workflowStatus]) => [id, { workflowStatus }]));
    } catch (error) {
      console.warn("Saved workbench state could not be loaded.", error);
      return {};
    }
  }

  function missingEvidence(sample) {
    return Object.entries(sample.evidence)
      .filter(([, available]) => !available)
      .map(([key]) => evidenceLabels[key]);
  }

  // Risk scoring mirrors a simple revenue test-of-details triage model. The score is
  // intentionally explainable: each exception adds a documented number of points.
  function assessRisk(sample) {
    const difference = sample.glAmount - sample.invoiceAmount;
    const mismatch = Math.abs(difference) > 0.01;
    const recognizedBeforeShipment = new Date(sample.revenueDate) < new Date(sample.shippingDate);
    const cashDays = Math.round((new Date(sample.cashReceiptDate) - new Date(sample.revenueDate)) / 86400000);
    const delayedCash = cashDays > riskRules.delayedCashDays;
    const roundDollar = sample.invoiceAmount >= 100000 && sample.invoiceAmount % 1000 === 0;
    const missing = missingEvidence(sample);
    const points = {
      mismatch: mismatch ? riskRules.amountMismatch : 0,
      cutoff: recognizedBeforeShipment ? riskRules.prematureRecognition : 0,
      missing: Math.min(missing.reduce((total, label) => {
        const key = Object.keys(evidenceLabels).find((item) => evidenceLabels[item] === label);
        return total + (riskRules.evidenceWeights[key] || 0);
      }, 0), riskRules.maxEvidencePoints),
      delayedCash: delayedCash ? riskRules.delayedCashReceipt : 0,
      roundDollar: roundDollar ? riskRules.roundDollarTransaction : 0
    };
    const score = Math.min(100, Object.values(points).reduce((total, value) => total + value, 0));
    const level = score >= riskRules.thresholds.high ? "High" : score >= riskRules.thresholds.medium ? "Medium" : "Low";
    const findings = [];

    if (mismatch) findings.push(`Invoice-to-GL difference of ${signedCurrency(difference)}`);
    if (recognizedBeforeShipment) findings.push("Revenue recognized before shipment");
    if (missing.length) findings.push(`${missing.length} missing evidence item${missing.length === 1 ? "" : "s"}`);
    if (delayedCash) findings.push(`Cash receipt collected ${cashDays} days after invoice`);
    if (roundDollar) findings.push("Round-dollar transaction selected for enhanced scrutiny");

    return { difference, mismatch, recognizedBeforeShipment, cashDays, delayedCash, roundDollar, missing, points, score, level, findings };
  }

  const persisted = loadPersistedState();
  const samples = revenueSamples.map((baseSample) => {
    const saved = persisted[baseSample.id] || {};
    const sample = {
      ...baseSample,
      invoiceNumber: baseSample.invoice,
      revenueDate: baseSample.recognitionDate,
      evidence: { ...baseSample.evidence, ...(saved.evidence || {}) },
      workflowStatus: normalizeStatus(saved.workflowStatus || baseSample.workflowStatus),
      auditNotes: typeof saved.auditNotes === "string" ? saved.auditNotes : "",
      pbcStatus: normalizePbcStatus(saved.pbcStatus),
      pbcText: typeof saved.pbcText === "string" ? saved.pbcText : "",
      workingPaperDraft: typeof saved.workingPaperDraft === "string" ? saved.workingPaperDraft : "",
      workingPaperStatus: saved.workingPaperStatus || "Not Started",
      workingPaperCustomized: Boolean(saved.workingPaperCustomized),
      workingPaperStale: Boolean(saved.workingPaperStale),
      managerComments: Array.isArray(saved.managerComments) ? saved.managerComments.map((comment) => ({ response: "", responseAt: "", ...comment })) : [],
      exceptionDecision: typeof saved.exceptionDecision === "string" ? saved.exceptionDecision : "",
      activityLog: Array.isArray(saved.activityLog) ? saved.activityLog : []
    };
    sample.risk = assessRisk(sample);
    if (sample.workflowStatus === "Reviewed" && sample.workingPaperDraft) {
      sample.workingPaperStatus = "Reviewed";
      sample.workingPaperStale = false;
    }
    if (!sample.exceptionDecision) {
      if (["Waiting for Client"].includes(sample.workflowStatus)) sample.exceptionDecision = "Follow-up required";
      else if (["Exception Noted"].includes(sample.workflowStatus)) sample.exceptionDecision = "Exception noted";
      else if (["Ready for Manager Review", "Reviewed"].includes(sample.workflowStatus)) sample.exceptionDecision = sample.risk.findings.length ? "Exception noted" : "No exception noted";
    }
    if (!pbcRequirements(sample).length) {
      sample.pbcStatus = "Not Required";
      sample.pbcText = "";
    } else if (!sample.pbcText) {
      sample.pbcStatus = "Drafted";
      sample.pbcText = buildPbcText(sample);
    }
    return sample;
  });

  function saveState() {
    const storedSamples = Object.fromEntries(samples.map((sample) => [sample.id, {
      evidence: sample.evidence,
      workflowStatus: sample.workflowStatus,
      auditNotes: sample.auditNotes,
      pbcStatus: sample.pbcStatus,
      pbcText: sample.pbcText,
      workingPaperDraft: sample.workingPaperDraft,
      workingPaperStatus: sample.workingPaperStatus,
      workingPaperCustomized: sample.workingPaperCustomized,
      workingPaperStale: sample.workingPaperStale,
      managerComments: sample.managerComments,
      exceptionDecision: sample.exceptionDecision,
      activityLog: sample.activityLog
    }]));

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 3, samples: storedSamples }));
    } catch (error) {
      console.warn("Workbench state could not be saved.", error);
      showToast("Changes could not be saved in this browser.", "error");
    }
  }

  function getSelectedSample() {
    return samples.find((sample) => sample.id === state.selectedId) || null;
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
    if (sample.risk.mismatch) ["Accuracy", "Occurrence"].forEach((item) => impacted.add(item));
    if (sample.risk.recognizedBeforeShipment) impacted.add("Cutoff");
    if (sample.risk.missing.length) ["Occurrence", "Existence"].forEach((item) => impacted.add(item));
    if (sample.risk.delayedCash) ["Valuation", "Collectibility"].forEach((item) => impacted.add(item));
    if (sample.risk.roundDollar) ["Occurrence", "Accuracy"].forEach((item) => impacted.add(item));

    if (sample.exceptionDecision === "No exception noted") impacted.clear();
    if (sample.exceptionDecision === "Exception noted" && !impacted.size) ["Occurrence", "Accuracy"].forEach((item) => impacted.add(item));

    return ["Occurrence", "Accuracy", "Cutoff", "Existence", "Valuation", "Collectibility"].map((name) => ({
      name,
      status: impacted.has(name) ? "Affected" : "No exception noted"
    }));
  }

  function auditOutcome(sample) {
    const assertions = assertionResults(sample).filter((assertion) => assertion.status === "Affected").map((assertion) => assertion.name);
    const decision = sample.exceptionDecision || "Not evaluated";
    const hasException = decision === "Exception noted";
    const needsFollowUp = decision === "Follow-up required";
    const followUp = sample.risk.missing.length
      ? `Obtain ${sample.risk.missing.join(", ")} and reperform the relevant procedures.`
      : sample.risk.recognizedBeforeShipment
        ? "Inspect shipping terms and evaluate whether the revenue entry requires a cutoff adjustment."
        : sample.risk.mismatch
          ? "Reconcile the invoice to the ledger and investigate the posting difference."
          : sample.risk.delayedCash
            ? "Evaluate collectibility and inspect subsequent cash receipt support."
            : "No additional follow-up is required based on the procedures performed.";

    let conclusion = "Exception evaluation has not been completed. Select an auditor disposition before routing this sample for review.";
    if (decision === "No exception noted") conclusion = "No exception was noted after evaluating the risk indicators and evidence obtained. The transaction is supported for the assertions tested.";
    else if (needsFollowUp) conclusion = "The sample remains open because additional evidence or audit procedures are required before a conclusion can be reached.";
    else if (hasException && sample.risk.score >= 65) conclusion = "A significant exception was identified. Escalate to the senior and evaluate the need for a proposed adjustment or expanded testing.";
    else if (hasException) conclusion = "An exception was identified and documented. Evaluate its disposition, potential misstatement impact, and effect on further procedures.";

    return {
      exceptionStatus: decision,
      assertions: assertions.length ? assertions : ["None"],
      followUp: needsFollowUp ? followUp : decision === "No exception noted" ? "No additional follow-up is required based on the auditor's recorded disposition." : followUp,
      conclusion
    };
  }

  function managerReviewSummary(sample) {
    const open = sample.managerComments.filter((comment) => !comment.resolved);
    const resolved = sample.managerComments.filter((comment) => comment.resolved);
    let status = "Not ready for review";
    if (sample.workflowStatus === "Reviewed") status = "Review complete";
    else if (open.length) status = "Review points open";
    else if (sample.workflowStatus === "Ready for Manager Review" || sample.workingPaperStatus === "Ready for Manager Review") status = "Ready for manager review";

    let conclusion = "Complete the associate procedures and route the sample for review.";
    if (open.length) conclusion = "Address all open review comments before final manager sign-off.";
    else if (sample.workflowStatus === "Reviewed") conclusion = "Manager review is complete; no open review points remain.";
    else if (sample.workflowStatus === "Ready for Manager Review") conclusion = sample.risk.findings.length
      ? "Review the documented exception, assertion impact, and proposed resolution before sign-off."
      : "The sample is ready for manager review and sign-off."

    return { status, open, resolved, conclusion };
  }

  function pbcRequirements(sample) {
    const requirements = sample.risk.missing.map((item) => `${item} supporting ${sample.invoiceNumber}`);
    if (sample.risk.mismatch) requirements.push(`Invoice-to-GL reconciliation and management explanation for the ${signedCurrency(sample.risk.difference)} difference`);
    if (sample.risk.recognizedBeforeShipment) requirements.push("Shipping terms, proof of delivery, and management's revenue cutoff analysis");
    if (sample.risk.delayedCash) requirements.push(`Subsequent cash receipt support and collectibility explanation (${sample.risk.cashDays} days after recognition)`);
    return requirements;
  }

  function buildPbcText(sample) {
    const requirements = pbcRequirements(sample);
    if (!requirements.length) return "No additional client support is required for this sample.";
    return `PBC REQUEST — REVENUE SAMPLE ${sample.id}\n\nClient: ${engagement.client}\nCustomer: ${sample.customer}\nInvoice: ${sample.invoiceNumber}\nAmount: ${currency(sample.invoiceAmount)}\nRequested by: ${engagement.preparer.name}, ${engagement.preparer.role}\n\nPlease provide the following support:\n${requirements.map((item, index) => `${index + 1}. ${item}`).join("\n")}\n\nPurpose: To complete revenue test-of-details procedures over occurrence, accuracy, cutoff, and collectibility. Please provide support that agrees to the transaction above and includes all relevant dates and terms.\n\nThank you.`;
  }

  function buildWorkingPaperText(sample) {
    const outcome = auditOutcome(sample);
    const manager = managerReviewSummary(sample);
    const evidenceReviewed = Object.entries(sample.evidence)
      .map(([key, available]) => `- ${evidenceLabels[key]}: ${available ? "Reviewed" : "Outstanding"}`)
      .join("\n");
    const exceptions = sample.risk.findings.length
      ? sample.risk.findings.map((finding) => `- ${finding}`).join("\n")
      : "- No exceptions noted.";
    const notes = sample.auditNotes || "No associate notes documented.";
    const reviewComments = sample.managerComments.length
      ? sample.managerComments.map((comment) => `- ${comment.resolved ? "Resolved" : "Open"}: ${comment.text}${comment.response ? ` | Associate response: ${comment.response}` : ""}`).join("\n")
      : "- No manager review comments.";

    return `AUDIT EVIDENCE COPILOT — REVENUE TEST OF DETAILS\nSample ${sample.id} | ${sample.customer}\nPrepared ${today()}\n\nOBJECTIVE\nTo test the occurrence, accuracy, cutoff, existence, valuation, and collectibility of the selected revenue transaction.\n\nPROCEDURE PERFORMED\nSelected invoice ${sample.invoiceNumber} for ${currency(sample.invoiceAmount)} and vouched the recorded revenue entry of ${currency(sample.glAmount)} to source documentation. Compared the revenue recognition date (${formatDate(sample.revenueDate)}) to the shipping date (${formatDate(sample.shippingDate)}), inspected subsequent cash receipt dated ${formatDate(sample.cashReceiptDate)}, and evaluated identified exceptions.\n\nEVIDENCE REVIEWED\n${evidenceReviewed}\n\nEXCEPTIONS NOTED\n${exceptions}\nAuditor disposition: ${sample.exceptionDecision || "Not evaluated"}\nRisk assessment: ${sample.risk.score}/100 — ${sample.risk.level}\n\nASSERTION IMPACT\n${outcome.assertions.join(", ")}\n\nASSOCIATE NOTES\n${notes}\n\nPBC STATUS\n${sample.pbcStatus}${pbcRequirements(sample).length ? ` — Requested items: ${pbcRequirements(sample).join("; ")}` : ""}\n\nAUDIT CONCLUSION\n${outcome.conclusion}\nFollow-up: ${outcome.followUp}\n\nPREPARED BY\n${engagement.preparer.name} · ${engagement.preparer.role} — ${today()}\n\nREVIEWED BY\n${engagement.reviewer.name} · ${engagement.reviewer.role} — ${sample.workflowStatus === "Reviewed" ? today() : "Pending"}\n\nREVIEW STATUS\n${manager.status}\nOpen comments: ${manager.open.length} | Resolved comments: ${manager.resolved.length}\n\nMANAGER REVIEW POINTS\n${reviewComments}`;
  }

  function refreshGeneratedArtifacts(sample) {
    sample.risk = assessRisk(sample);
    if (pbcRequirements(sample).length) {
      sample.pbcStatus = "Drafted";
      sample.pbcText = buildPbcText(sample);
    } else {
      sample.pbcStatus = "Not Required";
      sample.pbcText = "";
    }
    syncWorkingPaperSource(sample);
  }

  function syncWorkingPaperSource(sample) {
    if (!sample.workingPaperDraft) return;
    sample.workingPaperStatus = "Draft";
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
    const reviewed = samples.filter((sample) => sample.workflowStatus === "Reviewed").length;
    const ready = samples.filter((sample) => sample.workflowStatus === "Ready for Manager Review").length;
    const notStarted = samples.filter((sample) => sample.workflowStatus === "Not Started").length;
    const inProgress = samples.filter((sample) => sample.workflowStatus === "In Progress").length;
    const active = samples.filter((sample) => ["Not Started", "In Progress"].includes(sample.workflowStatus)).length;
    const followUp = samples.filter((sample) => ["Waiting for Client", "Exception Noted"].includes(sample.workflowStatus)).length;
    const completion = Math.round(((reviewed + ready) / samples.length) * 100);

    const testedValue = samples.reduce((total, sample) => total + sample.invoiceAmount, 0);
    byId("metricGrid").innerHTML = [
      ["#1769d2", "#eaf2fc", "Samples selected", samples.length, `${reviewed + ready} ready or reviewed`],
      ["#b7373f", "#fcebed", "High-risk items", high, `${samples.filter((sample) => sample.exceptionDecision === "Exception noted").length} documented exceptions`],
      ["#9a5d0b", "#fff2dc", "Missing evidence", missing, `${samples.filter((sample) => sample.risk.missing.length).length} samples affected`],
      ["#187452", "#e7f5ef", "Value tested", currency(testedValue), `${((testedValue / engagement.populationValue) * 100).toFixed(1)}% of population value`]
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
      waitingFilterCount: samples.filter((sample) => sample.workflowStatus === "Waiting for Client").length,
      exceptionFilterCount: samples.filter((sample) => sample.workflowStatus === "Exception Noted").length,
      readyFilterCount: ready,
      reviewedFilterCount: reviewed
    };
    Object.entries(filterCounts).forEach(([id, value]) => { if (byId(id)) byId(id).textContent = value; });

    const queue = samples.filter((sample) => sample.exceptionDecision === "Follow-up required" || sample.risk.findings.length || ["Waiting for Client", "Exception Noted"].includes(sample.workflowStatus))
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
    const term = state.searchTerm.trim().toLowerCase();
    return samples.filter((sample) => {
      const matchesSearch = !term || [sample.id, sample.customer, sample.invoiceNumber].some((value) => value.toLowerCase().includes(term));
      const matchesFilter = {
        All: true,
        "Not Started": sample.workflowStatus === "Not Started",
        "In Progress": sample.workflowStatus === "In Progress",
        "High Risk": sample.risk.level === "High",
        "Missing Evidence": sample.risk.missing.length > 0,
        "Waiting for Client": sample.workflowStatus === "Waiting for Client",
        "Exception Noted": sample.workflowStatus === "Exception Noted",
        "Ready for Manager Review": sample.workflowStatus === "Ready for Manager Review",
        Reviewed: sample.workflowStatus === "Reviewed"
      }[state.activeFilter];
      return matchesSearch && matchesFilter;
    });
  }

  function reconcileSelection(results) {
    if (!results.length) {
      state.selectedId = null;
      return;
    }
    if (!results.some((sample) => sample.id === state.selectedId)) state.selectedId = results[0].id;
  }

  function renderSamplesView() {
    const results = filteredSamples();
    reconcileSelection(results);
    const body = byId("sampleTableBody");
    const empty = byId("emptyState");
    const workspace = byId("sampleDetail");

    body.innerHTML = results.map((sample) => {
      const outcome = auditOutcome(sample);
      return `<tr tabindex="0" role="button" aria-label="Open ${sample.id}" data-sample-id="${sample.id}" class="${sample.id === state.selectedId ? "selected" : ""}">
        <td><span class="sample-id">${sample.id}</span></td>
        <td><strong>${escapeHtml(sample.customer)}</strong><small>${sample.invoiceNumber}</small></td>
        <td class="currency">${currency(sample.invoiceAmount)}</td>
        <td class="currency ${sample.risk.mismatch ? "amount-difference" : ""}">${currency(sample.glAmount)}</td>
        <td><span>${formatDate(sample.revenueDate)}</span><small>Ship ${formatDate(sample.shippingDate)}</small></td>
        <td><span class="evidence-count ${sample.risk.missing.length ? "missing" : ""}">${5 - sample.risk.missing.length}/5</span></td>
        <td><span class="exception-badge ${["Exception noted", "Follow-up required", "Not evaluated"].includes(outcome.exceptionStatus) ? "open" : ""}">${outcome.exceptionStatus}</span></td>
        <td><span class="workflow-badge ${slug(sample.workflowStatus)}">${sample.workflowStatus}</span></td>
        <td><span class="risk-badge ${sample.risk.level.toLowerCase()}">${sample.risk.level}<span class="risk-score">${sample.risk.score}</span></span></td>
        <td><button class="row-action" type="button" data-open-sample="${sample.id}" aria-label="Open ${sample.id}">›</button></td>
      </tr>`;
    }).join("");

    empty.hidden = results.length > 0;
    workspace.hidden = results.length === 0;
    byId("tableResultCount").textContent = results.length ? `Showing ${results.length} of ${samples.length} samples` : `No samples match the current filters (0 of ${samples.length})`;
    if (results.length) renderDetail(getSelectedSample());
  }

  function renderEvidence(sample) {
    byId("evidenceList").innerHTML = Object.entries(evidenceLabels).map(([key, label]) => {
      const available = sample.evidence[key];
      return `<label class="evidence-item ${available ? "available" : "missing"}">
        <input class="evidence-toggle" type="checkbox" data-evidence-key="${key}" ${available ? "checked" : ""} aria-label="${label} available">
        <span class="evidence-icon" aria-hidden="true">${available ? "✓" : "!"}</span>
        <span class="evidence-copy"><strong>${label}</strong><small>${available ? "Available and inspected" : "Missing — client follow-up required"}</small></span>
        <span class="evidence-state">${available ? "Available" : "Missing"}</span>
      </label>`;
    }).join("");

    const available = 5 - sample.risk.missing.length;
    byId("evidenceSummary").textContent = `Evidence Completion: ${available} / 5`;
    byId("evidenceSummary").className = `panel-summary ${sample.risk.missing.length ? "warning" : "complete"}`;
    byId("evidenceCallout").className = `evidence-callout ${sample.risk.missing.length ? "warning" : "complete"}`;
    byId("evidenceCallout").innerHTML = sample.risk.missing.length
      ? `<span aria-hidden="true">!</span><div><strong>${sample.risk.missing.length} item${sample.risk.missing.length === 1 ? "" : "s"} outstanding</strong><p>Toggle an item when support is received and inspected. Risk and downstream documentation update automatically.</p></div>`
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
      ["Evidence sufficiency", risk.missing.length > 0, risk.missing.length ? `${risk.missing.join(", ")} outstanding.` : "Required evidence is complete."],
      ["Subsequent receipt", risk.delayedCash, risk.delayedCash ? `Cash was received ${risk.cashDays} days after invoice.` : `Cash was received in ${risk.cashDays} days.`]
      , ["Round-dollar transaction", risk.roundDollar, risk.roundDollar ? "Round-dollar pricing requires enhanced scrutiny for management override risk." : "Transaction amount is not a round-dollar threshold item."]
    ];
    const factorPoints = [risk.points.mismatch, risk.points.cutoff, risk.points.missing, risk.points.delayedCash, risk.points.roundDollar];
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
    const decision = sample.exceptionDecision || "Not evaluated";
    byId("exceptionDecisionBadge").textContent = decision;
    byId("exceptionDecisionBadge").className = `workflow-badge ${slug(decision)}`;
    byId("exceptionDecisionActions").querySelectorAll("[data-exception-decision]").forEach((button) => {
      button.classList.toggle("active", button.dataset.exceptionDecision === decision);
    });
    const guidance = {
      "No exception noted": "The associate concluded that identified indicators were resolved and no exception remains.",
      "Exception noted": "The exception is documented and should be evaluated for misstatement impact and further procedures.",
      "Follow-up required": "Additional evidence or audit procedures remain outstanding before the sample can be concluded.",
      "Not evaluated": "Select a disposition to complete the exception evaluation."
    };
    byId("exceptionDecisionGuidance").textContent = guidance[decision];
  }

  function renderWorkflowProgress(sample) {
    const requirements = pbcRequirements(sample);
    const complete = {
      select: true,
      evidence: sample.risk.missing.length === 0,
      exception: Boolean(sample.exceptionDecision),
      pbc: !requirements.length || sample.pbcStatus === "Received",
      workpaper: Boolean(sample.workingPaperDraft),
      manager: sample.workflowStatus === "Reviewed"
    };
    const order = ["select", "evidence", "exception", "pbc", "workpaper", "manager"];
    const active = order.find((step) => !complete[step]) || "manager";
    document.querySelectorAll("[data-workflow-step]").forEach((item) => {
      const step = item.dataset.workflowStep;
      item.classList.toggle("complete", complete[step]);
      item.classList.toggle("active", step === active && !complete[step]);
    });
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
    byId("pbcRequestText").value = sample.pbcText;
    byId("pbcRequestText").placeholder = required ? "Generate or edit the client request here." : "No additional client support is required.";
    byId("pbcRequestText").disabled = !required;
    byId("generatePbcButton").disabled = !required;
    byId("copyPbcButton").disabled = !sample.pbcText;
    byId("markPbcSentButton").disabled = !sample.pbcText || ["Sent", "Received"].includes(sample.pbcStatus);
    byId("markPbcReceivedButton").disabled = sample.pbcStatus !== "Sent";
  }

  function renderWorkingPaperEditor(sample) {
    byId("workpaperEditorTitle").textContent = `${sample.id} · ${sample.customer}`;
    byId("workpaperEditorMeta").textContent = `${sample.invoiceNumber} · ${currency(sample.invoiceAmount)} · ${sample.risk.score}/100 ${sample.risk.level} risk`;
    byId("workpaperStatusBadge").textContent = sample.workingPaperStatus;
    byId("workpaperStatusBadge").className = `workflow-badge ${slug(sample.workingPaperStatus)}`;
    byId("workingPaperEditor").value = sample.workingPaperDraft;
    byId("workingPaperEditor").placeholder = "Generate a working paper from the active sample, then edit the draft here.";
    byId("workingPaperEditor").disabled = !sample.workingPaperDraft;
    byId("saveWorkingPaperButton").disabled = !sample.workingPaperDraft;
    byId("markReadyForManagerButton").disabled = !sample.workingPaperDraft;
    byId("workpaperSaveState").textContent = sample.workingPaperStale
      ? "Saved edits preserved · source data changed — regenerate to refresh"
      : sample.workingPaperDraft ? "Saved locally" : "No draft generated";
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
    byId("currentReviewStatus").textContent = sample.workflowStatus;
    byId("currentReviewStatus").className = `workflow-badge ${slug(sample.workflowStatus)}`;
    byId("reviewActionBar").querySelectorAll("[data-status]").forEach((button) => {
      button.classList.toggle("active", button.dataset.status === sample.workflowStatus);
    });
    byId("auditNotesInput").value = sample.auditNotes;
    byId("noteSaveState").textContent = sample.auditNotes ? "Saved locally" : "No note saved";
    byId("managerCommentComposer").hidden = true;
    byId("managerCommentInput").value = "";
    renderEvidence(sample);
    renderTransactionAndRisk(sample);
    renderAssertions(sample);
    renderExceptionDecision(sample);
    renderAuditOutcome(sample);
    renderPbc(sample);
    renderWorkingPaperEditor(sample);
    renderManagerReview(sample);
    renderActivityLog(sample);
    renderWorkflowProgress(sample);
  }

  function renderAll() {
    renderDashboard();
    renderSamplesView();
  }

  function updateReviewStatus(status) {
    const sample = getSelectedSample();
    if (!sample) return;
    if (status === "Ready for Manager Review" && sample.risk.missing.length) {
      showToast("Receive all required evidence before routing for review.", "error");
      return;
    }
    if (status === "Ready for Manager Review" && !sample.exceptionDecision) {
      showToast("Complete the exception decision before routing for review.", "error");
      return;
    }
    if (status === "Reviewed") {
      const manager = managerReviewSummary(sample);
      if (sample.workflowStatus !== "Ready for Manager Review") {
        showToast("Submit the sample for manager review before sign-off.", "error");
        return;
      }
      if (manager.open.length) {
        showToast("Resolve open manager comments before sign-off.", "error");
        return;
      }
    }
    sample.workflowStatus = status;
    if (status === "Reviewed" && sample.workingPaperDraft) {
      sample.workingPaperStatus = "Reviewed";
      sample.workingPaperStale = false;
    }
    if (status === "Waiting for Client" && pbcRequirements(sample).length) sample.pbcStatus = sample.pbcStatus === "Received" ? "Drafted" : sample.pbcStatus;
    addActivity(sample, status === "In Progress" ? "Review started" : `Status changed to ${status}`);
    syncWorkingPaperSource(sample);
    saveState();
    renderAll();
    showToast(`Review status updated to ${status}.`);
  }

  function handleEvidenceChange(event) {
    const input = event.target.closest("[data-evidence-key]");
    if (!input) return;
    const sample = getSelectedSample();
    if (!sample) return;
    sample.evidence[input.dataset.evidenceKey] = input.checked;
    if (["Ready for Manager Review", "Reviewed"].includes(sample.workflowStatus)) sample.workflowStatus = "In Progress";
    if (!input.checked) sample.exceptionDecision = "Follow-up required";
    addActivity(sample, `Evidence item ${input.checked ? "checked" : "unchecked"}`, evidenceLabels[input.dataset.evidenceKey]);
    refreshGeneratedArtifacts(sample);
    saveState();
    renderAll();
    showToast(`${evidenceLabels[input.dataset.evidenceKey]} marked ${input.checked ? "available" : "missing"}.`);
  }

  function saveAuditNote() {
    const sample = getSelectedSample();
    if (!sample) return;
    sample.auditNotes = byId("auditNotesInput").value.trim();
    addActivity(sample, "Audit note saved", sample.auditNotes ? sample.auditNotes.slice(0, 120) : "Blank note saved");
    syncWorkingPaperSource(sample);
    saveState();
    renderWorkingPaperEditor(sample);
    renderActivityLog(sample);
    byId("noteSaveState").textContent = sample.auditNotes ? "Saved locally" : "No note saved";
    showToast("Audit note saved.");
  }

  function clearAuditNote() {
    const sample = getSelectedSample();
    if (!sample) return;
    sample.auditNotes = "";
    byId("auditNotesInput").value = "";
    addActivity(sample, "Audit note cleared");
    syncWorkingPaperSource(sample);
    saveState();
    renderWorkingPaperEditor(sample);
    renderActivityLog(sample);
    byId("noteSaveState").textContent = "No note saved";
    showToast("Audit note cleared.");
  }

  function generatePbcRequest() {
    const sample = getSelectedSample();
    if (!sample || !pbcRequirements(sample).length) {
      showToast("No PBC request is required for this sample.", "error");
      return;
    }
    sample.pbcText = buildPbcText(sample);
    sample.pbcStatus = "Drafted";
    addActivity(sample, "PBC request generated", `${pbcRequirements(sample).length} requested item${pbcRequirements(sample).length === 1 ? "" : "s"}`);
    syncWorkingPaperSource(sample);
    saveState();
    renderPbc(sample);
    renderWorkingPaperEditor(sample);
    renderActivityLog(sample);
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
    if (!sample?.pbcText) return;
    await copyText(sample.pbcText);
    addActivity(sample, "PBC request copied");
    saveState();
    renderActivityLog(sample);
    showToast("PBC request copied to clipboard.");
  }

  function updatePbcStatus(status) {
    const sample = getSelectedSample();
    if (!sample || !sample.pbcText) return;
    if (status === "Received" && sample.pbcStatus !== "Sent") {
      showToast("Mark the request sent before marking it received.", "error");
      return;
    }
    sample.pbcStatus = status;
    sample.workflowStatus = status === "Sent" ? "Waiting for Client" : "In Progress";
    addActivity(sample, `PBC marked ${status.toLowerCase()}`);
    syncWorkingPaperSource(sample);
    saveState();
    renderAll();
    showToast(`PBC request marked ${status.toLowerCase()}.`);
  }

  function generateWorkingPaper() {
    const sample = getSelectedSample();
    if (!sample) return;
    sample.workingPaperDraft = buildWorkingPaperText(sample);
    sample.workingPaperStatus = "Draft";
    sample.workingPaperCustomized = false;
    sample.workingPaperStale = false;
    addActivity(sample, "Working paper draft generated");
    saveState();
    renderWorkingPaperEditor(sample);
    renderActivityLog(sample);
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
    addActivity(sample, "Working paper saved");
    saveState();
    renderWorkingPaperEditor(sample);
    renderActivityLog(sample);
    showToast("Working paper saved locally.");
  }

  function markReadyForManager() {
    const sample = getSelectedSample();
    if (!sample) return;
    if (sample.risk.missing.length) {
      showToast("Outstanding evidence must be resolved before manager review.", "error");
      return;
    }
    if (!sample.exceptionDecision) {
      showToast("Complete the exception decision before submitting for review.", "error");
      return;
    }
    if (sample.workingPaperStale) {
      showToast("Save an updated draft or regenerate before manager review.", "error");
      return;
    }
    sample.workingPaperDraft = byId("workingPaperEditor").value.trim();
    if (!sample.workingPaperDraft) return;
    sample.workingPaperStatus = "Ready for Manager Review";
    sample.workingPaperCustomized = true;
    sample.workingPaperStale = false;
    sample.workflowStatus = "Ready for Manager Review";
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
    if (decision === "Exception noted") sample.workflowStatus = "Exception Noted";
    else if (["Exception Noted", "Ready for Manager Review", "Reviewed"].includes(sample.workflowStatus)) sample.workflowStatus = "In Progress";
    addActivity(sample, `Exception decision: ${decision}`);
    syncWorkingPaperSource(sample);
    saveState();
    renderAll();
    showToast(`Exception decision updated to ${decision.toLowerCase()}.`);
  }

  function updatePbcDraft() {
    const sample = getSelectedSample();
    if (!sample) return;
    sample.pbcText = byId("pbcRequestText").value;
    sample.pbcStatus = pbcRequirements(sample).length ? "Drafted" : "Not Required";
    syncWorkingPaperSource(sample);
    saveState();
    byId("pbcStatusBadge").textContent = sample.pbcStatus;
    byId("pbcStatusBadge").className = `workflow-badge ${slug(sample.pbcStatus)}`;
    byId("copyPbcButton").disabled = !sample.pbcText.trim();
    byId("markPbcSentButton").disabled = !sample.pbcText.trim();
    byId("markPbcReceivedButton").disabled = true;
    renderWorkingPaperEditor(sample);
  }

  function logPbcEdit() {
    const sample = getSelectedSample();
    if (!sample || !sample.pbcText.trim()) return;
    addActivity(sample, "PBC request edited");
    saveState();
    renderActivityLog(sample);
  }

  function openSample(sampleId) {
    const sample = samples.find((item) => item.id === sampleId);
    if (!sample) return;
    state.selectedId = sampleId;
    renderSamplesView();
    byId("sampleDetail").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function resetFilters() {
    state.activeFilter = "All";
    state.searchTerm = "";
    byId("searchInput").value = "";
    document.querySelectorAll(".filter-button").forEach((button) => button.classList.toggle("active", button.dataset.filter === "All"));
    renderSamplesView();
  }

  function exportPopulation() {
    const headers = ["Sample ID", "Customer", "Invoice", "Invoice Amount", "GL Amount", "Recognition Date", "Shipping Date", "Cash Receipt Date", "Evidence Available", "Risk Score", "Risk Level", "Review Status"];
    const rows = samples.map((sample) => [sample.id, sample.customer, sample.invoiceNumber, sample.invoiceAmount, sample.glAmount, sample.revenueDate, sample.shippingDate, sample.cashReceiptDate, `${5 - sample.risk.missing.length}/5`, sample.risk.score, sample.risk.level, sample.workflowStatus]);
    const csv = [headers, ...rows].map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "audit-evidence-copilot-revenue-samples.csv";
    link.click();
    URL.revokeObjectURL(url);
    showToast("Sample population exported.");
  }

  function bindEvents() {
    document.querySelectorAll(".nav-link[data-section]").forEach((button) => button.addEventListener("click", () => {
      document.querySelectorAll(".nav-link").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
    }));

    document.querySelectorAll(".filter-button").forEach((button) => button.addEventListener("click", () => {
      state.activeFilter = button.dataset.filter;
      document.querySelectorAll(".filter-button").forEach((item) => item.classList.toggle("active", item === button));
      renderSamplesView();
    }));

    byId("searchInput").addEventListener("input", (event) => { state.searchTerm = event.target.value; renderSamplesView(); });
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
    byId("saveNoteButton").addEventListener("click", saveAuditNote);
    byId("clearNoteButton").addEventListener("click", clearAuditNote);
    byId("generatePbcButton").addEventListener("click", generatePbcRequest);
    byId("jumpToPbcButton").addEventListener("click", () => byId("pbcRequestPanel").scrollIntoView({ behavior: "smooth", block: "center" }));
    byId("copyPbcButton").addEventListener("click", copyPbcRequest);
    byId("markPbcSentButton").addEventListener("click", () => updatePbcStatus("Sent"));
    byId("markPbcReceivedButton").addEventListener("click", () => updatePbcStatus("Received"));
    byId("pbcRequestText").addEventListener("input", updatePbcDraft);
    byId("pbcRequestText").addEventListener("change", logPbcEdit);
    ["generatePaperButton", "generateFromDetail"].forEach((id) => byId(id).addEventListener("click", generateWorkingPaper));
    byId("workingPaperEditor").addEventListener("input", () => { byId("workpaperSaveState").textContent = "Unsaved changes"; });
    byId("saveWorkingPaperButton").addEventListener("click", saveWorkingPaper);
    byId("markReadyForManagerButton").addEventListener("click", markReadyForManager);
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
      state.activeFilter = "High Risk";
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
    state.selectedId = samples.some((sample) => sample.id === DEFAULT_SAMPLE_ID) ? DEFAULT_SAMPLE_ID : samples[0]?.id || null;
    state.activeFilter = "All";
    state.searchTerm = "";
    byId("searchInput").value = "";
    bindEvents();
    renderAll();
  }

  document.addEventListener("DOMContentLoaded", initialize);
})();
