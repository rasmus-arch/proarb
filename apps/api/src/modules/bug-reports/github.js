// GitHub issue sync — same pattern as integrations/fortnox.js: works for
// real once GITHUB_ISSUES_TOKEN/GITHUB_ISSUES_REPO are set (see
// .env.example), otherwise every report is still saved locally (see
// service.js) and simply marked NOT_CONFIGURED so nothing is lost while
// waiting for a token.
//
// This system is sold to more than one customer against the same repo, so
// TENANT_NAME (set per deployment) is stamped on the issue and used as a
// GitHub label — that's how the developer tells reports from different
// customers apart in one shared issue tracker.

const GITHUB_ISSUES_TOKEN = process.env.GITHUB_ISSUES_TOKEN;
const GITHUB_ISSUES_REPO = process.env.GITHUB_ISSUES_REPO; // "owner/repo"
const TENANT_NAME = process.env.TENANT_NAME || null;

export const isGithubIssuesConfigured = () => Boolean(GITHUB_ISSUES_TOKEN && GITHUB_ISSUES_REPO);

export async function createGithubIssue(report) {
  if (!isGithubIssuesConfigured()) {
    return { ok: false, reason: "NOT_CONFIGURED", note: "GitHub-integrationen är inte konfigurerad." };
  }

  const labels = ["buggrapport"];
  if (TENANT_NAME) labels.push(TENANT_NAME);

  const body = [
    report.description,
    "",
    "---",
    `**Allvarlighetsgrad:** ${report.severity}`,
    `**Rapporterad av:** ${report.reporterName}${report.reporterEmail ? ` (${report.reporterEmail})` : ""}`,
    TENANT_NAME ? `**Kund:** ${TENANT_NAME}` : null,
    report.pageUrl ? `**Sida:** ${report.pageUrl}` : null,
    report.userAgent ? `**Webbläsare:** ${report.userAgent}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  let res;
  try {
    res = await fetch(`https://api.github.com/repos/${GITHUB_ISSUES_REPO}/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GITHUB_ISSUES_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: report.title, body, labels }),
    });
  } catch (err) {
    return { ok: false, reason: "NETWORK_ERROR", note: err.message };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, reason: "GITHUB_ERROR", note: `GitHub svarade ${res.status}: ${text.slice(0, 200)}` };
  }

  const issue = await res.json();
  return { ok: true, issueNumber: issue.number, issueUrl: issue.html_url };
}
