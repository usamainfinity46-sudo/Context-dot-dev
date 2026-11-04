import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// Never open the application's live SQLite database from a test process.
const testData = fs.mkdtempSync(path.join(os.tmpdir(), "context-test-data-"));
process.env.DATA_DIR = testData;
process.on("exit", () => fs.rmSync(testData, { recursive: true, force: true }));
