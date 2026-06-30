/*
 * Fictional engagement data for the Audit Evidence Copilot portfolio project.
 * The application reads this file directly so it can run from index.html with no server.
 */

const engagement = Object.freeze({
  client: "Northstar Technologies, Inc.",
  shortName: "Northstar",
  engagementId: "NST-2025-AUD",
  period: "Year ended December 31, 2025",
  area: "Revenue",
  framework: "ASC 606",
  auditStandard: "PCAOB",
  entityType: "Issuer",
  significantRisk: "Presumed fraud risk related to revenue recognition",
  relevantAssertions: ["Occurrence", "Cutoff", "Accuracy"],
  auditApproach: "Primarily substantive",
  overallMateriality: 500000,
  performanceMateriality: 375000,
  postingThreshold: 25000,
  populationValue: 28450000,
  populationCount: 1842,
  sampleMethod: "Nonstatistical random + targeted",
  populationSource: "Revenue transaction listing REV_POP_2025_v3",
  populationReconciliation: "Agreed to trial balance and general ledger",
  cutoffWindow: "December 18, 2025 – January 6, 2026",
  preparer: { name: "Alex Morgan", initials: "AM", role: "Audit Associate" },
  reviewer: { name: "Jordan Lee", initials: "JL", role: "Audit Manager" }
});

const riskRules = Object.freeze({
  amountMismatch: 30,
  prematureRecognition: 35,
  delayedCashReceipt: 15,
  delayedCashDays: 60,
  roundDollarTransaction: 10,
  incompleteEvidence: 10,
  evidenceException: 20,
  thresholds: Object.freeze({ medium: 30, high: 60 })
});

const revenueSamples = [
  {
    id: "REV-001", customer: "Atlas Cloud Systems", invoice: "INV-250184", invoiceAmount: 184500, glAmount: 184500,
    invoiceDate: "2025-12-18", recognitionDate: "2025-12-18", shippingDate: "2025-12-17", cashReceiptDate: "2026-01-14", workflowStatus: "Not Started",
    selectionBasis: "Random sample", owner: "AM",
    evidence: { invoice: true, salesContract: true, shippingDocument: true, cashReceipt: true, glDetail: true }
  },
  {
    id: "REV-002", customer: "Meridian Health Group", invoice: "INV-250207", invoiceAmount: 267800, glAmount: 267800,
    invoiceDate: "2025-12-22", recognitionDate: "2025-12-22", shippingDate: "2025-12-23", cashReceiptDate: "2026-02-18", workflowStatus: "In Progress",
    selectionBasis: "Cutoff selection", owner: "AM",
    evidence: { invoice: true, salesContract: true, shippingDocument: true, cashReceipt: true, glDetail: true }
  },
  {
    id: "REV-003", customer: "Summit Data Partners", invoice: "INV-250231", invoiceAmount: 93250, glAmount: 93000,
    invoiceDate: "2025-12-27", recognitionDate: "2025-12-27", shippingDate: "2025-12-27", cashReceiptDate: "2026-01-25", workflowStatus: "Exception Noted",
    selectionBasis: "Random sample", owner: "AM",
    evidence: { invoice: true, salesContract: true, shippingDocument: true, cashReceipt: false, glDetail: true }
  },
  {
    id: "REV-004", customer: "Pioneer Logistics LLC", invoice: "INV-250244", invoiceAmount: 418700, glAmount: 418700,
    invoiceDate: "2025-12-29", recognitionDate: "2025-12-29", shippingDate: "2026-01-03", cashReceiptDate: "2026-03-21", workflowStatus: "Waiting for Client",
    selectionBasis: "High-value selection", owner: "AM",
    evidence: { invoice: true, salesContract: false, shippingDocument: true, cashReceipt: false, glDetail: true }
  },
  {
    id: "REV-005", customer: "Cobalt Financial Services", invoice: "INV-250251", invoiceAmount: 156400, glAmount: 156400,
    invoiceDate: "2025-12-30", recognitionDate: "2025-12-30", shippingDate: "2025-12-29", cashReceiptDate: "2026-01-19", workflowStatus: "Reviewed",
    selectionBasis: "Random sample", owner: "AM",
    evidence: { invoice: true, salesContract: true, shippingDocument: true, cashReceipt: true, glDetail: true }
  },
  {
    id: "REV-006", customer: "Evergreen Retail Co.", invoice: "INV-250263", invoiceAmount: 73400, glAmount: 73400,
    invoiceDate: "2025-12-31", recognitionDate: "2025-12-31", shippingDate: "2025-12-30", cashReceiptDate: "2026-04-12", workflowStatus: "Not Started",
    selectionBasis: "Cutoff selection", owner: "AM",
    evidence: { invoice: true, salesContract: true, shippingDocument: true, cashReceipt: true, glDetail: true }
  },
  {
    id: "REV-007", customer: "Redwood Energy Corp.", invoice: "INV-250271", invoiceAmount: 325000, glAmount: 320000,
    invoiceDate: "2025-12-31", recognitionDate: "2025-12-31", shippingDate: "2026-01-06", cashReceiptDate: "2026-03-30", workflowStatus: "Exception Noted",
    selectionBasis: "High-value selection", owner: "AM",
    evidence: { invoice: true, salesContract: true, shippingDocument: false, cashReceipt: false, glDetail: true }
  },
  {
    id: "REV-008", customer: "Lumen Media Works", invoice: "INV-250279", invoiceAmount: 48800, glAmount: 48800,
    invoiceDate: "2025-12-31", recognitionDate: "2025-12-31", shippingDate: "2025-12-31", cashReceiptDate: "2026-01-30", workflowStatus: "Reviewed",
    selectionBasis: "Random sample", owner: "AM",
    evidence: { invoice: true, salesContract: true, shippingDocument: true, cashReceipt: true, glDetail: true }
  },
  {
    id: "REV-009", customer: "Harbor Industrial Supply", invoice: "INV-250282", invoiceAmount: 211600, glAmount: 211600,
    invoiceDate: "2025-12-31", recognitionDate: "2025-12-31", shippingDate: "2025-12-30", cashReceiptDate: "2026-02-15", workflowStatus: "Waiting for Client",
    selectionBasis: "Cutoff selection", owner: "AM",
    evidence: { invoice: true, salesContract: false, shippingDocument: true, cashReceipt: true, glDetail: true }
  },
  {
    id: "REV-010", customer: "Nova Education Network", invoice: "INV-250291", invoiceAmount: 129900, glAmount: 129900,
    invoiceDate: "2025-12-31", recognitionDate: "2025-12-31", shippingDate: "2025-12-31", cashReceiptDate: "2026-01-28", workflowStatus: "Ready for Manager Review",
    selectionBasis: "Random sample", owner: "AM",
    evidence: { invoice: true, salesContract: true, shippingDocument: true, cashReceipt: true, glDetail: true }
  }
];
