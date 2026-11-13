/** Labels for people using the workspace; stored permission and status codes stay unchanged. */
const ROLE_LABELS: Record<string, string> = {
  "R-OWNER": "Organisation owner",
  "R-ADMIN": "Administrator",
  "R-PM": "Project manager",
  "R-QC": "Quality reviewer",
  "R-SITE": "Site engineer",
  "R-DOC": "Document controller",
  "R-AUDITOR": "Auditor",
  "R-SAFETY": "Safety officer",
  "R-BILLING": "Billing manager",
  "R-PROC": "Procurement coordinator",
  "R-REVIEWER": "Reviewer",
  "R-CONSULTANT": "Consultant",
  "R-CLIENT": "Client representative",
  "R-SUBCONTRACTOR": "Subcontractor",
};
const STATUS_LABELS: Record<string, string> = {
  NOT_STARTED: "Not started",
  REQUESTED: "Requested",
  UPLOADED: "Uploaded",
  IN_REVIEW: "Awaiting review",
  CHANGES_REQUESTED: "Changes requested",
  APPROVED_EXTERNAL: "Approved externally",
  NOT_APPLICABLE: "Not applicable",
  HANDOVER: "Handover in progress",
  QUEUED: "Waiting to be prepared",
  GENERATING: "Preparing",
  PROCESSING: "Being checked",
  READY: "Ready",
  FAILED: "Needs attention",
  QUARANTINED: "File blocked",
  ACCEPT_WITH_EXCEPTIONS: "Accepted with exceptions",
  PARTIALLY_ACCEPTED: "Partially accepted",
};
export function humanLabel(value?: string | null): string {
  if (!value) return "Not recorded";
  return (
    STATUS_LABELS[value] ||
    value
      .toLowerCase()
      .replace(/_/g, " ")
      .replace(/^\w/, (c) => c.toUpperCase())
  );
}
export function roleLabel(value?: string | null): string {
  return value ? ROLE_LABELS[value] || "Team member" : "Team member";
}
export function displayDate(value?: string | null): string {
  if (!value) return "Not set";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Not set";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(date);
}
export function displayMoney(paise?: string | number | null): string {
  if (paise === undefined || paise === null || paise === "")
    return "Not recorded";
  try {
    const amount = BigInt(paise);
    const absolute = amount < 0n ? -amount : amount;
    const rupees = new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(absolute / 100n);
    return `${amount < 0n ? "-" : ""}${rupees.replace(/\.00$/, `.${String(absolute % 100n).padStart(2, "0")}`)}`;
  } catch {
    return "Not recorded";
  }
}

export const INDIAN_STATES: ReadonlyArray<readonly [string, string]> = [
  ["AN", "Andaman and Nicobar Islands"],
  ["AP", "Andhra Pradesh"],
  ["AR", "Arunachal Pradesh"],
  ["AS", "Assam"],
  ["BR", "Bihar"],
  ["CH", "Chandigarh"],
  ["CG", "Chhattisgarh"],
  ["DN", "Dadra and Nagar Haveli and Daman and Diu"],
  ["DL", "Delhi"],
  ["GA", "Goa"],
  ["GJ", "Gujarat"],
  ["HR", "Haryana"],
  ["HP", "Himachal Pradesh"],
  ["JK", "Jammu and Kashmir"],
  ["JH", "Jharkhand"],
  ["KA", "Karnataka"],
  ["KL", "Kerala"],
  ["LA", "Ladakh"],
  ["LD", "Lakshadweep"],
  ["MP", "Madhya Pradesh"],
  ["MH", "Maharashtra"],
  ["MN", "Manipur"],
  ["ML", "Meghalaya"],
  ["MZ", "Mizoram"],
  ["NL", "Nagaland"],
  ["OD", "Odisha"],
  ["PY", "Puducherry"],
  ["PB", "Punjab"],
  ["RJ", "Rajasthan"],
  ["SK", "Sikkim"],
  ["TN", "Tamil Nadu"],
  ["TS", "Telangana"],
  ["TR", "Tripura"],
  ["UP", "Uttar Pradesh"],
  ["UK", "Uttarakhand"],
  ["WB", "West Bengal"],
];

export function problemMessage(problem: {
  status?: number;
  code?: string;
  detail?: string;
  title?: string;
}): string {
  const detail = problem.detail || problem.title || "";
  if (problem.status === 429)
    return /otp|verification/i.test(detail)
      ? "Too many verification code requests. Try again later."
      : "Too many requests. Please wait before trying again.";
  if (/MAIL_GATEWAY|SMS_GATEWAY|DLT_/.test(problem.code || ""))
    return "We could not send your verification code. Please try again later or contact your organisation administrator.";
  if (problem.status === 500)
    return "We could not complete that action. Please try again. If the problem continues, contact support.";
  if (
    detail &&
    !/\b(?:PostgreSQL|Redis|S3_BUCKET|MAIL_API_KEY|MAIL_GATEWAY_URL|ENABLE_\w+|UUID|SQL|NOBYPASSRLS|tc_app|requestId)\b|[A-Z]{2,}_[A-Z_]{2,}/.test(
      detail,
    )
  )
    return detail;
  if (problem.status === 403)
    return "You do not have permission to perform this action. Contact your organisation administrator if you need access.";
  if (problem.status === 404)
    return "This record is unavailable or you no longer have access to it.";
  if (problem.status === 503)
    return "This service is temporarily unavailable. Please try again later.";
  return "We could not complete that action. Check the details and try again.";
}
