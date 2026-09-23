// GitHub issue sync — same self-service pattern as integrations/fortnox.js
// and integrations/email.js: reads its credentials from app_settings
// (github_issues_token/github_issues_repo, filled in under Inställningar)
// instead of env vars, so staff can turn this on without a redeploy. Every
// report is still saved locally first (see service.js) and simply marked
// NOT_CONFIGURED so nothing is lost while waiting for a token.
//
// TENANT_NAME (optional env var, unrelated to the settings above) stamps a
// label on the issue — only relevant if this same repo ever receives
// reports from more than one deployment; harmless to leave unset otherwise.
const TENANT_NAME = process.env.TENANT_NAME || null;

export const isGithubIssuesConfigured = (settings) =>
  Boolean(settings?.github_issues_token && settings?.github_issues_repo);

export async function createGithubIssue(report, settings) {
  if (!isGithubIssuesConfigured(settings)) {
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
    res = await fetch(`https://api.github.com/repos/${settings.github_issues_repo}/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.github_issues_token}`,
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
