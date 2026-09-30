import { Router } from "express";
import { createBackup, listBackups, backupFilePath, backupDir } from "../../lib/backup.js";
import { getSettings } from "../settings/service.js";

const router = Router();

router.get("/", (req, res) => {
  res.json({ rows: listBackups(), directory: backupDir });
});

router.post("/", async (req, res, next) => {
  try {
    const settings = await getSettings();
    res.status(201).json(await createBackup({ keepDays: settings?.backup_keep_days }));
  } catch (err) {
    next(err);
  }
});

router.get("/:name", (req, res) => {
  const file = backupFilePath(req.params.name);
  if (!file) return res.status(404).json({ error: "Not found" });
  res.download(file);
});

export default router;
