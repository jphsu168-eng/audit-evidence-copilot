/* global engagement, revenueSamples, riskRules */

(() => {
  "use strict";

  const STORAGE_KEY = "audit-evidence-copilot.workflow.v1";
  const evidenceMeta = Object.freeze({
    invoice: { label: "Invoice", code: "INV", assertion: "Occurrence / accuracy" },
    salesContract: { label: "Sales contract", code: "CON", assertion: "Occurrence / rights" },
    shippingDocument: { label: "Shipping document", code: "SHP", assertion: "Cutoff / occurrence" },
    cashReceipt: { label: "Cash receipt", code: "CSH", assertion: "Collectibility" },
    glDetail: { label: "GL detail", code: "GL", assertion: "Accuracy / completeness" }
  });
  const icons = Object.freeze({
    samples: '<svg viewBox="0 0 24 24"><path d="M5 3h14v18H5zM8 7h8M8 11h8M8 15h5"/></svg>',
    risk: '<svg viewBox="0 0 24 24"><path d="M12 3 2 21h20L12 3Z"/><path d="M12 9v5M12 18h.01"/></svg>',
    missing: '<svg viewBox="0 0 24 24"><path d="M6 2h9l4 4v16H6zM14 2v5h5M9 13h6"/></svg>',
    value: '<svg viewBox="0 0 24 24"><path d="M4 7h16v12H4zM7 4h10v3M8 13h8M12 10v6"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>',
    cross: '<svg viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17"/></svg>',
    arrow: '<svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>'
  });
  const riskColors = Object.freeze({ High: "#b7373f", Medium: "#c17a18", Low: "#27906a" });
  const state = { selectedId: revenueSamples[0].id, riskFilter: "All", statusFilter: "All", searchTerm: "", paperSampleId: null };
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];

  const money = value => new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 0
  }).format(value);
  const compactMoney = value => new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2
  }).format(value);
  const shortDate = value => new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC"
  }).format(new Date(`${value}T00:00:00Z`));
  const daysBetween = (start, end) => Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
  const slugify = value => value.toLowerCase().replaceAll(" ", "-");
  const escapeHtml = value => String(value).replace(/[&<>'"]/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);

  function loadWorkflowOverrides() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); }
    catch { return {}; }
  }

  function saveWorkflowOverrides() {
    try {
      const overrides = Object.fromEntries(samples.map(sample => [sample.id, sample.workflowStatus]));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
    } catch {
      showToast("Status updated for this session; browser storage is unavailable.");
    }
  }

  function missingEvidence(sample) {
    return Object.entries(sample.evidence)
      .filter(([, available]) => !available)
      .map(([key]) => ({ key, ...evidenceMeta[key] }));
  }

  /**
   * Transparent prioritization logic for the educational prototype.
   * The engine evaluates four common revenue-test signals and caps the total at 100.
   * It supports audit judgment; it does not replace a firm's methodology or conclusion.
   */
  function assessRisk(sample) {
    const findings = [];
    const difference = sample.invoiceAmount - sample.glAmount;
    const cutoffDays = daysBetween(sample.recognitionDate, sample.shippingDate);
    const receiptDays = daysBetween(sample.recognitionDate, sample.cashReceiptDate);
    const missing = missingEvidence(sample);

    if (difference !== 0) {
      const direction = difference > 0 ? "exceeds" : "is below";
      const differencePoints = Math.abs(difference) >= engagement.postingThreshold ? riskRules.amountMismatch : riskRules.amountMismatchBelowThreshold;
      const thresholdContext = Math.abs(difference) < engagement.postingThreshold ? " The difference is below the clearly trivial threshold but remains an audit exception requiring explanation." : " The difference meets or exceeds the clearly trivial threshold.";
      findings.push({ key: "accuracy", label: "Amount mismatch", points: differencePoints, detail: `Invoice ${direction} the GL posting by ${money(Math.abs(difference))}.${thresholdContext}` });
    }
    if (cutoffDays > 0) {
      findings.push({ key: "cutoff", label: "Premature recognition", points: riskRules.prematureRecognition, detail: `Revenue was recognized ${cutoffDays} day${cutoffDays === 1 ? "" : "s"} before shipment.` });
    }
    missing.forEach(document => findings.push({
      key: `evidence-${document.key}`,
      label: `Missing ${document.label.toLowerCase()}`,
      points: riskRules.evidenceWeights[document.key],
      detail: `${document.label} is not available; evidence for ${document.assertion.toLowerCase()} is incomplete.`
    }));
    if (receiptDays > riskRules.delayedCashDays) {
      findings.push({ key: "collectibility", label: "Delayed cash receipt", points: riskRules.delayedCashReceipt, detail: `Cash was received ${receiptDays} days after revenue recognition (${receiptDays - riskRules.delayedCashDays} days beyond the review threshold).` });
    }

    const score = Math.min(findings.reduce((total, finding) => total + finding.points, 0), 100);
    const level = score >= riskRules.thresholds.high ? "High" : score >= riskRules.thresholds.medium ? "Medium" : "Low";
    return { score, level, findings, difference, cutoffDays, receiptDays, missing };
  }

  const workflowOverrides = loadWorkflowOverrides();
  const samples = revenueSamples.map(sample => ({
    ...sample,
    evidence: { ...sample.evidence },
    workflowStatus: workflowOverrides[sample.id] || sample.workflowStatus
  }));
  samples.forEach(sample => { sample.risk = assessRisk(sample); });

  function selectedSample() { return samples.find(sample => sample.id === state.selectedId); }

  function assertionResults(sample) {
    const { risk } = sample;
    const result = (name, procedure, status, rationale, category = "Relevant assertion") => ({ name, procedure, status, rationale, category });
    return [
      result("Occurrence", "Agree invoice and contract to the customer transaction.", sample.evidence.invoice && sample.evidence.salesContract ? "Pass" : "Exception", sample.evidence.invoice && sample.evidence.salesContract ? "Invoice and executed contract available." : "Required source evidence is incomplete."),
      result("Accuracy", "Agree invoice value to the general ledger posting.", risk.difference === 0 && sample.evidence.glDetail ? "Pass" : "Exception", risk.difference === 0 ? "Invoice agrees to GL with no variance." : `${money(Math.abs(risk.difference))} variance requires follow-up.`),
      result("Cutoff", "Compare recognition date with proof of shipment.", risk.cutoffDays <= 0 && sample.evidence.shippingDocument ? "Pass" : "Exception", risk.cutoffDays <= 0 ? "Revenue was not recognized before shipment." : `Recognition precedes shipment by ${risk.cutoffDays} days.`),
      result("Collectibility", "Inspect subsequent cash receipt and elapsed days.", !sample.evidence.cashReceipt ? "Pending" : risk.receiptDays > riskRules.delayedCashDays ? "Exception" : "Pass", !sample.evidence.cashReceipt ? "Cash receipt support is outstanding." : `Receipt occurred ${risk.receiptDays} days after recognition.`, "Supporting procedure"),
      result("Evidence", "Assess whether the evidence package is complete.", risk.missing.length ? "Pending" : "Pass", risk.missing.length ? `${risk.missing.length} required document${risk.missing.length === 1 ? " is" : "s are"} outstanding.` : "All five required documents are available.", "Sufficiency assessment")
    ];
  }

  function renderDashboard() {
    const totalValue = samples.reduce((total, sample) => total + sample.invoiceAmount, 0);
    const grossDifferences = samples.reduce((total, sample) => total + Math.abs(sample.risk.difference), 0);
    const highRisk = samples.filter(sample => sample.risk.level === "High").length;
    const missingCount = samples.reduce((total, sample) => total + sample.risk.missing.length, 0);
    const complete = samples.filter(sample => ["Prepared", "Reviewed"].includes(sample.workflowStatus)).length;
    const completion = Math.round(complete / samples.length * 100);
    const coverage = totalValue / engagement.populationValue * 100;
    const openCount = samples.filter(sample => sample.workflowStatus !== "Reviewed").length;
    const metrics = [
      { label: "Samples selected", value: samples.length, note: `${coverage.toFixed(1)}% value coverage`, icon: icons.samples, color: "#1559b7", pale: "#eaf2fc" },
      { label: "High-risk samples", value: highRisk, note: "Prioritized for follow-up", icon: icons.risk, color: "#b7373f", pale: "#fcebed" },
      { label: "Evidence outstanding", value: missingCount, note: "Across selected samples", icon: icons.missing, color: "#9a5d0b", pale: "#fff2dc" },
      { label: "Potential differences", value: compactMoney(grossDifferences), note: "Pending exception evaluation", icon: icons.value, color: "#187452", pale: "#e7f5ef" }
    ];

    $("#metricGrid").innerHTML = metrics.map(item => `
      <article class="panel metric-card" style="--metric-color:${item.color};--metric-pale:${item.pale}">
        <div class="metric-top"><span class="metric-label">${item.label}</span><span class="metric-icon">${item.icon}</span></div>
        <strong>${item.value}</strong><p><b>${item.note}</b></p>
      </article>`).join("");
    $("#highRiskButtonCount").textContent = highRisk;
    $("#navOpenCount").textContent = openCount;
    $("#sampleCoverage").textContent = `${coverage.toFixed(1)}% of population value`;
    $("#workflowProgress").textContent = `${complete} of ${samples.length} prepared`;
    $("#progressPercent").textContent = `${completion}%`;
    $(".large-progress").setAttribute("aria-valuenow", completion);
    requestAnimationFrame(() => { $("#progressBar").style.width = `${completion}%`; });

    const statusItems = [
      ["Reviewed", samples.filter(s => s.workflowStatus === "Reviewed").length, "#187452"],
      ["Prepared", samples.filter(s => s.workflowStatus === "Prepared").length, "#1769d2"],
      ["In progress", samples.filter(s => s.workflowStatus === "In progress").length, "#7b8ca0"],
      ["Needs follow-up", samples.filter(s => ["Exception", "Awaiting evidence"].includes(s.workflowStatus)).length, "#b7373f"]
    ];
    $("#progressLegend").innerHTML = statusItems.map(([label, count, color]) => `<span class="legend-item"><i class="legend-dot" style="background:${color}"></i><b>${count}</b> ${label}</span>`).join("");

    const riskCounts = ["High", "Medium", "Low"].map(level => [level, samples.filter(sample => sample.risk.level === level).length]);
    $("#riskBars").innerHTML = riskCounts.map(([level, count]) => `<div class="risk-bar-row"><span>${level} risk</span><span class="mini-bar"><i style="width:${count / samples.length * 100}%;background:${riskColors[level]}"></i></span><b>${count}</b></div>`).join("");

    const queue = [...samples].filter(sample => sample.risk.findings.length).sort((a, b) => b.risk.score - a.risk.score).slice(0, 3);
    $("#actionQueue").innerHTML = queue.map(sample => `<button type="button" class="action-item" data-open-sample="${sample.id}"><span class="action-icon">${icons.risk}</span><span><strong>${escapeHtml(sample.id)} · ${escapeHtml(sample.customer)}</strong><span>${sample.risk.findings.length} exception${sample.risk.findings.length === 1 ? "" : "s"} · ${escapeHtml(sample.workflowStatus)}</span></span><b>${sample.risk.score}</b></button>`).join("");
  }

  function filteredSamples() {
    const term = state.searchTerm.toLowerCase();
    return samples.filter(sample => {
      const matchesRisk = state.riskFilter === "All" || sample.risk.level === state.riskFilter;
      const matchesStatus = state.statusFilter === "All" || sample.workflowStatus === state.statusFilter;
      const matchesSearch = [sample.id, sample.customer, sample.invoice].some(value => value.toLowerCase().includes(term));
      return matchesRisk && matchesStatus && matchesSearch;
    });
  }

  function reconcileSelection(rows) {
    if (rows.length && !rows.some(sample => sample.id === state.selectedId)) {
      state.selectedId = rows[0].id;
      invalidateWorkingPaper();
    }
  }

  function invalidateWorkingPaper() {
    if (!state.paperSampleId) return;
    $("#workingPaperOutput").hidden = true;
    $("#workingPaperPlaceholder").hidden = false;
    state.paperSampleId = null;
  }

  function renderTable() {
    const rows = filteredSamples();
    reconcileSelection(rows);
    $("#sampleTableBody").innerHTML = rows.map(sample => {
      const totalEvidence = Object.keys(sample.evidence).length;
      const availableEvidence = totalEvidence - sample.risk.missing.length;
      return `<tr data-id="${sample.id}" class="${state.selectedId === sample.id ? "selected" : ""}" tabindex="0" aria-label="Open ${escapeHtml(sample.id)} ${escapeHtml(sample.customer)}">
        <td><span class="sample-id">${escapeHtml(sample.id)}</span></td>
        <td class="customer-cell"><strong>${escapeHtml(sample.customer)}</strong><span>${escapeHtml(sample.invoice)}</span></td>
        <td class="currency">${money(sample.invoiceAmount)}</td>
        <td class="currency ${sample.risk.difference ? "amount-difference" : ""}">${money(sample.glAmount)}</td>
        <td class="date-cell">${shortDate(sample.recognitionDate)}<span>Ship ${shortDate(sample.shippingDate)}</span></td>
        <td><span class="evidence-count ${sample.risk.missing.length ? "missing" : ""}">${sample.risk.missing.length ? icons.missing : icons.check}${availableEvidence}/${totalEvidence}</span></td>
        <td><span class="workflow-badge ${slugify(sample.workflowStatus)}">${escapeHtml(sample.workflowStatus)}</span></td>
        <td><span class="risk-badge ${sample.risk.level.toLowerCase()}">${sample.risk.level}<span class="risk-score">${sample.risk.score}</span></span></td>
        <td><span class="row-action">${icons.arrow}</span></td>
      </tr>`;
    }).join("");
    $("#emptyState").hidden = rows.length > 0;
    $("#tableResultCount").textContent = `Showing ${rows.length} of ${samples.length} samples`;
    $("#allCount").textContent = samples.length;
    if (rows.length) renderDetail();
  }

  function renderDetail() {
    const sample = selectedSample();
    if (!sample) return;
    const { risk } = sample;
    $("#detailTitle").textContent = `${sample.id} · ${sample.customer}`;
    $("#detailSubtitle").textContent = `${sample.invoice} · ${money(sample.invoiceAmount)} · Owner ${sample.owner}`;
    $("#selectionBasis").textContent = `Selection basis: ${sample.selectionBasis}`;
    $("#workflowStatusSelect").value = sample.workflowStatus;
    const badge = $("#detailRiskBadge");
    badge.className = `risk-badge ${risk.level.toLowerCase()}`;
    badge.innerHTML = `${risk.level} risk <span class="risk-score">${risk.score}/100</span>`;

    $("#dateTimeline").innerHTML = [
      ["Revenue recognized", sample.recognitionDate, risk.cutoffDays > 0],
      ["Goods shipped", sample.shippingDate, risk.cutoffDays > 0],
      ["Cash received", sample.cashReceiptDate, risk.receiptDays > riskRules.delayedCashDays]
    ].map(([label, date, alert]) => `<div class="timeline-item ${alert ? "alert" : ""}"><i class="timeline-dot"></i><small>${label}</small><strong>${shortDate(date)}</strong></div>`).join("");

    $("#amountComparison").innerHTML = `
      <div class="amount-box"><small>Invoice amount</small><strong>${money(sample.invoiceAmount)}</strong></div>
      <div class="amount-box"><small>GL amount</small><strong>${money(sample.glAmount)}</strong></div>
      <div class="amount-box"><small>Difference</small><strong class="${risk.difference ? "amount-difference" : ""}">${money(Math.abs(risk.difference))}</strong></div>`;
    const differenceEvaluation = $("#differenceEvaluation");
    differenceEvaluation.className = `difference-evaluation ${risk.difference ? "exception" : ""}`;
    differenceEvaluation.innerHTML = risk.difference
      ? `<span><strong>Potential misstatement:</strong> Unexplained ${risk.difference > 0 ? "understatement" : "overstatement"} relative to the invoice. Investigate the cause before disposition.</span><span class="threshold-tag">${Math.abs(risk.difference) < engagement.postingThreshold ? "Below" : "Above"} CTT</span>`
      : `<span><strong>Difference evaluation:</strong> Invoice agrees to the recorded GL amount.</span><span class="threshold-tag">No difference</span>`;

    $("#riskFindings").innerHTML = risk.findings.length
      ? risk.findings.map(finding => `<div class="finding flag">${icons.risk}<span><strong>${escapeHtml(finding.label)}:</strong> ${escapeHtml(finding.detail)}</span><span class="finding-points">+${finding.points}</span></div>`).join("")
      : `<div class="finding clear">${icons.check}<span><strong>No exceptions identified.</strong> Amounts, timing, receipt aging, and evidence passed the configured checks.</span><span class="finding-points">0</span></div>`;

    const reviewPoints = [];
    if (risk.cutoffDays > 0) reviewPoints.push("Evaluate whether the cutoff exception indicates systematic bias and consider extending testing on both sides of year-end.");
    if (risk.difference) reviewPoints.push("Obtain a reconciliation for the invoice-to-GL difference and determine whether it represents a factual, judgmental, or projected misstatement.");
    if (risk.missing.length) reviewPoints.push("Resolve open PBC items or document the alternative procedure performed; inquiry alone is not sufficient appropriate audit evidence.");
    if (risk.receiptDays > riskRules.delayedCashDays) reviewPoints.push("Corroborate collectibility and consider whether the delay affects the ASC 606 collectibility criterion or expected credit loss assessment.");
    const reviewContent = reviewPoints.length
      ? `<ul>${reviewPoints.slice(0, 2).map(point => `<li>${escapeHtml(point)}</li>`).join("")}</ul>`
      : "Confirm cross-references, tickmarks, and the preparer conclusion before routing this sample for review.";
    $("#managerReviewPoint").innerHTML = `<div><strong>Manager review focus</strong>${reviewContent}</div>`;

    const availableCount = Object.keys(sample.evidence).length - risk.missing.length;
    $("#evidenceSummary").textContent = `${availableCount} of ${Object.keys(sample.evidence).length} required documents available`;
    $("#evidenceList").innerHTML = Object.entries(sample.evidence).map(([key, available], index) => {
      const meta = evidenceMeta[key];
      const reference = available ? `${sample.id}-${meta.code}-${String(index + 1).padStart(2, "0")}` : "PBC request open";
      return `<div class="evidence-item"><i class="check-icon ${available ? "" : "missing"}">${available ? icons.check : icons.cross}</i><span class="evidence-name"><strong>${meta.label}</strong><small>${reference} · ${meta.assertion}</small></span><span class="evidence-state ${available ? "" : "missing"}">${available ? "Available" : "Missing"}</span></div>`;
    }).join("");
    const callout = $("#evidenceCallout");
    callout.className = `evidence-callout ${risk.missing.length ? "incomplete" : "complete"}`;
    callout.innerHTML = risk.missing.length
      ? `<strong>Preparer action:</strong> Obtain ${risk.missing.map(item => item.label.toLowerCase()).join(" and ")} before final sign-off.`
      : "<strong>Evidence ready:</strong> The required package is complete and available for reviewer inspection.";

    $("#assertionMatrix").innerHTML = assertionResults(sample).map(item => `<article class="assertion-item"><small>${item.category}</small><div class="assertion-item-header"><h3>${item.name}</h3><span class="result-badge ${item.status.toLowerCase()}">${item.status}</span></div><p><strong>${item.procedure}</strong><br>${item.rationale}</p></article>`).join("");
  }

  function setWorkflowStatus(nextStatus) {
    const sample = selectedSample();
    if (nextStatus === "Reviewed") {
      $("#workflowStatusSelect").value = sample.workflowStatus;
      showToast("Manager credentials are required to mark a sample reviewed.");
      return;
    }
    if (nextStatus === "Prepared" && sample.risk.missing.length) {
      $("#workflowStatusSelect").value = sample.workflowStatus;
      showToast("Resolve missing evidence before marking this sample prepared.");
      return;
    }
    if (nextStatus === "Prepared" && sample.risk.findings.length) {
      $("#workflowStatusSelect").value = sample.workflowStatus;
      showToast("Document and resolve exceptions before preparer sign-off.");
      return;
    }
    sample.workflowStatus = nextStatus;
    invalidateWorkingPaper();
    saveWorkflowOverrides();
    renderDashboard();
    renderTable();
    showToast(`${sample.id} moved to ${nextStatus}.`);
  }

  function generateWorkingPaper() {
    const sample = selectedSample();
    const { risk } = sample;
    const assertions = assertionResults(sample);
    const evidenceReviewed = Object.entries(sample.evidence).filter(([, available]) => available).map(([key]) => evidenceMeta[key].label);
    const exceptionItems = risk.findings.length
      ? risk.findings.map(item => `<li><strong>${escapeHtml(item.label)}:</strong> ${escapeHtml(item.detail)}</li>`).join("")
      : "<li>No exceptions were identified from the procedures performed.</li>";
    const conclusion = risk.level === "High"
      ? "The sample contains exceptions affecting one or more relevant assertions. Additional evidence, exception resolution, and engagement team evaluation are required before a conclusion can be reached. Consider whether the findings indicate a proposed adjustment or broader population risk."
      : risk.level === "Medium"
        ? "The procedures identified matters requiring follow-up. No pervasive issue has been concluded; however, the open items must be resolved and documented before preparer sign-off."
        : "Based on the procedures performed and evidence obtained, the transaction was recorded accurately and in the appropriate period. No exceptions were identified for this sample.";
    const sections = [
      ["Objective", "To determine whether the selected revenue transaction occurred, was accurately recorded, was recognized in the appropriate reporting period, and is supported by sufficient appropriate audit evidence."],
      ["Risk and audit response", `${engagement.significantRisk}. The engagement team adopted a ${engagement.auditApproach.toLowerCase()} approach focused on the occurrence, cutoff, and accuracy assertions, including targeted year-end testing.`],
      ["Population and selection", `${engagement.populationSource} was reconciled to the trial balance and general ledger. ${sample.id} was selected using ${sample.selectionBasis.toLowerCase()} from ${engagement.populationCount.toLocaleString("en-US")} transactions totaling ${money(engagement.populationValue)}.`],
      ["Procedure performed", `Agreed invoice ${sample.invoice} to the general ledger, inspected available contractual and shipping support, compared the recognition date with the shipping date for cutoff, and inspected the subsequent cash receipt. Evaluated occurrence, accuracy, cutoff, collectibility, and evidence sufficiency.`],
      ["Evidence reviewed", `<ul>${evidenceReviewed.map(item => `<li>${escapeHtml(item)}</li>`).join("")}${risk.missing.map(item => `<li>${escapeHtml(item.label)} — <strong>not provided</strong></li>`).join("")}</ul>`],
      ["Assertion results", `<ul>${assertions.map(item => `<li><strong>${item.name} — ${item.status}:</strong> ${escapeHtml(item.rationale)}</li>`).join("")}</ul>`],
      ["Difference evaluation", risk.difference ? `A potential ${risk.difference > 0 ? "understatement" : "overstatement"} of ${money(Math.abs(risk.difference))} was identified relative to the invoice. The amount is ${Math.abs(risk.difference) < engagement.postingThreshold ? "below" : "above"} the ${money(engagement.postingThreshold)} clearly trivial threshold; the nature and cause must still be evaluated before disposition.` : "No invoice-to-GL difference was identified."],
      ["Exceptions", `<ul>${exceptionItems}</ul>`, risk.findings.length ? "exception" : ""],
      ["Audit conclusion", conclusion, "conclusion"]
    ];

    $("#wpSections").innerHTML = sections.map(([title, content, className = ""]) => `<section class="wp-section ${className}"><h3>${title}</h3><div>${content.startsWith("<") ? content : `<p>${escapeHtml(content)}</p>`}</div></section>`).join("");
    $("#wpSampleId").textContent = sample.id;
    $("#wpCustomer").textContent = `${sample.customer} · ${sample.invoice} · ${money(sample.invoiceAmount)}`;
    $("#wpRisk").textContent = `${risk.level} risk · ${risk.score}/100`;
    $("#preparedDate").textContent = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date());
    $("#preparerSignoff").textContent = sample.workflowStatus === "Prepared" ? "Prepared" : `Draft · ${sample.workflowStatus}`;
    $("#workingPaperPlaceholder").hidden = true;
    $("#workingPaperOutput").hidden = false;
    state.paperSampleId = sample.id;
    $("#workingPaperOutput").scrollIntoView({ behavior: "smooth", block: "start" });
    showToast(`Working paper generated for ${sample.id}.`);
  }

  function exportCSV() {
    const headers = ["Sample ID", "Customer", "Invoice Number", "Selection Basis", "Workflow Status", "Invoice Amount", "GL Amount", "Potential Difference", "Revenue Recognition Date", "Shipping Date", "Cash Receipt Date", "Evidence Missing", "Risk Score", "Risk Level"];
    const escapeCsv = value => `"${String(value).replaceAll('"', '""')}"`;
    const rows = samples.map(sample => [sample.id, sample.customer, sample.invoice, sample.selectionBasis, sample.workflowStatus, sample.invoiceAmount, sample.glAmount, Math.abs(sample.risk.difference), sample.recognitionDate, sample.shippingDate, sample.cashReceiptDate, sample.risk.missing.map(item => item.label).join("; ") || "None", sample.risk.score, sample.risk.level]);
    const csv = [headers, ...rows].map(row => row.map(escapeCsv).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = Object.assign(document.createElement("a"), { href: url, download: "northstar-revenue-testing.csv" });
    document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    showToast("Revenue testing data exported.");
  }

  let toastTimer;
  function showToast(message) {
    const toast = $("#toast");
    toast.querySelector("span").textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
  }

  function applyFilters() {
    state.riskFilter = $(".filter-button.active").dataset.risk;
    state.statusFilter = $("#statusFilter").value;
    state.searchTerm = $("#searchInput").value.trim();
    renderTable();
  }

  function resetFilters() {
    state.riskFilter = "All"; state.statusFilter = "All"; state.searchTerm = "";
    $("#searchInput").value = ""; $("#statusFilter").value = "All";
    $$(".filter-button").forEach(button => button.classList.toggle("active", button.dataset.risk === "All"));
    renderTable();
  }

  function openSample(id, clearActiveFilters = false) {
    if (id !== state.selectedId) invalidateWorkingPaper();
    state.selectedId = id;
    if (clearActiveFilters) {
      state.riskFilter = "All"; state.statusFilter = "All"; state.searchTerm = "";
      $("#searchInput").value = ""; $("#statusFilter").value = "All";
      $$(".filter-button").forEach(button => button.classList.toggle("active", button.dataset.risk === "All"));
    }
    renderTable();
    $("#sampleDetail").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function bindEvents() {
    $("#searchInput").addEventListener("input", applyFilters);
    $("#statusFilter").addEventListener("change", applyFilters);
    $(".filter-group").addEventListener("click", event => {
      const button = event.target.closest(".filter-button");
      if (!button) return;
      $$(".filter-button").forEach(item => item.classList.toggle("active", item === button));
      applyFilters();
    });
    $("#sampleTableBody").addEventListener("click", event => {
      const row = event.target.closest("tr[data-id]");
      if (row) openSample(row.dataset.id);
    });
    $("#sampleTableBody").addEventListener("keydown", event => {
      const row = event.target.closest("tr[data-id]");
      if (row && ["Enter", " "].includes(event.key)) { event.preventDefault(); openSample(row.dataset.id); }
    });
    $("#actionQueue").addEventListener("click", event => {
      const item = event.target.closest("[data-open-sample]");
      if (item) openSample(item.dataset.openSample, true);
    });
    $("#clearFilters").addEventListener("click", resetFilters);
    $("#reviewHighRisk").addEventListener("click", () => {
      state.riskFilter = "High"; state.statusFilter = "All"; state.searchTerm = "";
      $("#searchInput").value = ""; $("#statusFilter").value = "All";
      $$(".filter-button").forEach(button => button.classList.toggle("active", button.dataset.risk === "High"));
      renderTable(); $("#samples").scrollIntoView({ behavior: "smooth" });
    });
    $("#workflowStatusSelect").addEventListener("change", event => setWorkflowStatus(event.target.value));
    $("#riskMethodButton").addEventListener("click", () => {
      const method = $("#riskMethod"); method.hidden = !method.hidden;
      $("#riskMethodButton").setAttribute("aria-expanded", String(!method.hidden));
    });
    ["#generatePaperButton", "#generatePlaceholderButton", "#generateFromDetail"].forEach(selector => $(selector).addEventListener("click", generateWorkingPaper));
    $("#exportButton").addEventListener("click", exportCSV);
    $("#printButton").addEventListener("click", () => window.print());
    $("#backToSampleButton").addEventListener("click", () => $("#sampleDetail").scrollIntoView({ behavior: "smooth", block: "start" }));
    $$('[data-jump]').forEach(button => button.addEventListener("click", () => $(`#${button.dataset.jump}`).scrollIntoView({ behavior: "smooth" })));

    const sidebar = $("#sidebar"), scrim = $("#sidebarScrim"), menu = $("#menuButton");
    const setMenu = open => {
      sidebar.classList.toggle("open", open); scrim.classList.toggle("open", open);
      menu.setAttribute("aria-expanded", String(open)); menu.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
    };
    menu.addEventListener("click", () => setMenu(!sidebar.classList.contains("open")));
    scrim.addEventListener("click", () => setMenu(false));
    $$(".nav-link").forEach(link => link.addEventListener("click", () => setMenu(false)));
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        setMenu(false); $("#riskMethod").hidden = true; $("#riskMethodButton").setAttribute("aria-expanded", "false");
      }
    });

    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) $$(".nav-link[data-section]").forEach(link => link.classList.toggle("active", link.dataset.section === entry.target.id));
    }), { rootMargin: "-20% 0px -70%" });
    $$(".page-section").forEach(section => observer.observe(section));
  }

  renderDashboard();
  renderTable();
  bindEvents();
})();
