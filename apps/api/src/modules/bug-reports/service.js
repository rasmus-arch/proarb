import { pool } from "../../lib/db.js";
import { createGithubIssue } from "./github.js";

export async function createBugReport(data, user) {
  const title = (data.title ?? "").trim();
  const description = (data.description ?? "").trim();
  if (!title || !description) throw new Error("INVALID_BUG_REPORT");

  const severity = ["LOW", "MEDIUM", "HIGH"].includes(data.severity) ? data.severity : "MEDIUM";

  const [result] = await pool.query(
    `INSERT INTO bug_reports (reported_by, title, description, severity, page_url, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [user.id, title, description, severity, data.pageUrl ?? null, data.userAgent ?? null]
  );
  const id = result.insertId;

  // Best-effort, same as the Fortnox invoice sync in pos/service.js: the
  // report is already safely stored above, so a GitHub outage (or it not
  // being configured yet) never loses it — just leaves it PENDING/FAILED
  // for someone to retry or read straight from the database.
  const sync = await createGithubIssue({
    title,
    description,
    severity,
    pageUrl: data.pageUrl,
    userAgent: data.userAgent,
    reporterName: user.name,
    reporterEmail: user.email,
  });

  if (sync.ok) {
    await pool.query(
      `UPDATE bug_reports SET github_sync_status = 'SYNCED', github_issue_number = ?, github_issue_url = ? WHERE id = ?`,
      [sync.issueNumber, sync.issueUrl, id]
    );
  } else {
    const status = sync.reason === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "FAILED";
    await pool.query(`UPDATE bug_reports SET github_sync_status = ?, github_sync_note = ? WHERE id = ?`, [
      status,
      sync.note ?? null,
      id,
    ]);
  }

  const [[row]] = await pool.query(`SELECT * FROM bug_reports WHERE id = ?`, [id]);
  return row;
}

export async function listBugReports() {
  const [rows] = await pool.query(
    `SELECT br.*, u.name AS reporter_name
     FROM bug_reports br JOIN users u ON u.id = br.reported_by
     ORDER BY br.created_at DESC`
  );
  return rows;
}
