const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const { connectLambda, getStore } = require("@netlify/blobs");

const SUBMISSION_STORE_NAME = "private-contact-details";
const CSV_FILE_NAME = "contact-submissions.csv";
const CSV_STORE_NAME = "private-contact-submissions";

exports.handler = async (event) => {
  connectLambda(event);

  if (!isAuthorized(event)) {
    return htmlResponse(403, "<h1>403 Forbidden</h1>");
  }

  const id = sanitizeId(event.queryStringParameters?.id || "");
  if (!id) {
    return htmlResponse(400, "<h1>Bad Request</h1><p>id is required.</p>");
  }

  try {
    const detail = await loadDetail(id);
    if (!detail) {
      return htmlResponse(404, "<h1>Not Found</h1>");
    }

    return htmlResponse(200, renderDetailPage(detail, event.queryStringParameters.token || ""));
  } catch (error) {
    console.error("contact-detail failed", error);
    return htmlResponse(500, "<h1>Error</h1><p>問い合わせ情報を読み込めませんでした。</p>");
  }
};

async function loadDetail(id) {
  const detailDir = isServerlessRuntime() ? "" : process.env.CONTACT_DETAIL_DIR || defaultLocalDetailDir();

  if (detailDir) {
    let json;
    try {
      json = await fs.readFile(path.join(detailDir, `${id}.json`), "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
    return JSON.parse(json);
  }

  const store = getBlobStore(SUBMISSION_STORE_NAME);
  let json;
  try {
    json = await store.get(`${id}.json`, { type: "text" });
  } catch (error) {
    if (error.status === 404 || error.statusCode === 404) return null;
    throw error;
  }
  if (json) return JSON.parse(json);
  return loadDetailFromCsv(id);
}

async function loadDetailFromCsv(id) {
  const csv = await loadCsvText();
  if (!csv) return null;

  const rows = parseCsv(csv);
  const row = rows.find((item) => item.submission_id === id);
  if (!row) return null;

  return {
    received_at: row.received_at || "",
    submission_id: row.submission_id || id,
    name: row.name || "",
    company: row.company || "",
    email: row.email || "",
    message: row.message || "",
    files: parseAttachments(row.attachments || ""),
  };
}

async function loadCsvText() {
  const csvPath = isServerlessRuntime() ? "" : process.env.CONTACT_CSV_PATH || defaultLocalCsvPath();

  if (csvPath) {
    try {
      return await fs.readFile(csvPath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return "";
      throw error;
    }
  }

  const store = getBlobStore(CSV_STORE_NAME);
  return await store.get(CSV_FILE_NAME, { type: "text" }) || "";
}

function renderDetailPage(detail, token) {
  const files = Array.isArray(detail.files) ? detail.files : [];
  const csvParams = new URLSearchParams({ token });
  const fileItems = files.length
    ? files.map((file, index) => {
        const params = new URLSearchParams({ id: detail.submission_id, file: String(index), token });
        return `<li><a href="/.netlify/functions/contact-file?${params.toString()}">${escapeHtml(file.fileName)}</a> <span>${escapeHtml(formatBytes(file.size))}</span></li>`;
      }).join("")
    : "<li>添付ファイルなし</li>";

  return `<!doctype html>
<html lang="ja">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>お問い合わせ詳細</title>
<style>
  body { margin: 0; background: #f6f4ee; color: #253238; font: 16px/1.7 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  main { max-width: 880px; margin: 0 auto; padding: 32px 20px 48px; }
  h1 { margin: 0 0 20px; font-size: 28px; }
  .actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 0 0 18px; }
  .button { display: inline-flex; align-items: center; justify-content: center; min-height: 42px; padding: 0 16px; border-radius: 6px; background: #253238; color: #fff; text-decoration: none; font-weight: 800; }
  section { margin-top: 18px; padding: 20px; border: 1px solid #d9d2c4; border-radius: 8px; background: #fff; }
  dl { display: grid; grid-template-columns: 140px minmax(0, 1fr); gap: 10px 18px; margin: 0; }
  dt { color: #5b6670; font-weight: 700; }
  dd { margin: 0; word-break: break-word; }
  pre { white-space: pre-wrap; word-break: break-word; margin: 0; font: inherit; }
  ul { margin: 0; padding-left: 20px; }
  a { color: #1769aa; font-weight: 700; }
</style>
<main>
  <h1>お問い合わせ詳細</h1>
  <div class="actions">
    <a class="button" href="/.netlify/functions/contact-csv?${csvParams.toString()}">CSVをダウンロード</a>
  </div>
  <section>
    <dl>
      <dt>受付日時</dt><dd>${escapeHtml(detail.received_at || "")}</dd>
      <dt>お名前</dt><dd>${escapeHtml(detail.name || "")}</dd>
      <dt>会社名</dt><dd>${escapeHtml(detail.company || "-")}</dd>
      <dt>メール</dt><dd><a href="mailto:${escapeAttribute(detail.email || "")}">${escapeHtml(detail.email || "")}</a></dd>
      <dt>受付ID</dt><dd>${escapeHtml(detail.submission_id || "")}</dd>
    </dl>
  </section>
  <section>
    <h2>内容</h2>
    <pre>${escapeHtml(detail.message || "")}</pre>
  </section>
  <section>
    <h2>添付ファイル</h2>
    <ul>${fileItems}</ul>
  </section>
</main>
</html>`;
}

function isAuthorized(event) {
  const expected = process.env.CONTACT_VIEW_TOKEN || (isServerlessRuntime() ? "" : "local-dev");
  const actual = event.queryStringParameters?.token || "";
  return Boolean(expected) && actual === expected;
}

function defaultLocalDetailDir() {
  if (isServerlessRuntime()) return "";
  if (process.env.CONTACT_CSV_PATH) return path.join(path.dirname(process.env.CONTACT_CSV_PATH), "details");
  return path.join(os.tmpdir(), "contact-details");
}

function defaultLocalCsvPath() {
  if (isServerlessRuntime()) return "";
  return path.join(os.tmpdir(), CSV_FILE_NAME);
}

function isServerlessRuntime() {
  return Boolean(
    process.env.NETLIFY ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.LAMBDA_TASK_ROOT
  );
}

function getBlobStore(name) {
  return getStore(name);
}

function sanitizeId(value) {
  return String(value).replace(/[^a-zA-Z0-9_.-]/g, "");
}

function parseCsv(csv) {
  const text = csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv;
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  const headers = rows.shift() || [];
  return rows
    .filter((item) => item.length)
    .map((item) => Object.fromEntries(headers.map((header, index) => [header, item[index] || ""])));
}

function parseAttachments(value) {
  if (!value) return [];

  return value.split(" / ").map((attachment) => {
    const match = attachment.match(/^(.*) \((.*), (\d+) bytes, (.*)\)$/);
    if (!match) {
      return { fileName: attachment, size: 0, mimeType: "", savedPath: "", storageType: "" };
    }

    const savedPath = match[4];
    return {
      fileName: match[1],
      mimeType: match[2],
      size: Number(match[3] || 0),
      savedPath,
      blobKey: savedPath.startsWith("netlify-blob://")
        ? savedPath.replace(/^netlify-blob:\/\/private-contact-uploads\//, "")
        : "",
      storageType: savedPath.startsWith("netlify-blob://") ? "blob" : "file",
    };
  });
}

function formatBytes(value) {
  const size = Number(value || 0);
  if (size < 1024) return `${size} bytes`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function htmlResponse(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "text/html; charset=utf-8" },
    body,
  };
}
