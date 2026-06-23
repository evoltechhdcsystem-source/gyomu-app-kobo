const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const { getStore } = require("@netlify/blobs");

const SUBMISSION_STORE_NAME = "private-contact-details";

exports.handler = async (event) => {
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
  const detailDir = process.env.CONTACT_DETAIL_DIR || defaultLocalDetailDir();

  if (detailDir) {
    const json = await fs.readFile(path.join(detailDir, `${id}.json`), "utf8");
    return JSON.parse(json);
  }

  const store = getStore(SUBMISSION_STORE_NAME);
  const json = await store.get(`${id}.json`, { type: "text", consistency: "strong" });
  return json ? JSON.parse(json) : null;
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
  const expected = process.env.CONTACT_VIEW_TOKEN || (process.env.NETLIFY ? "" : "local-dev");
  const actual = event.queryStringParameters?.token || "";
  return Boolean(expected) && actual === expected;
}

function defaultLocalDetailDir() {
  if (process.env.NETLIFY) return "";
  if (process.env.CONTACT_CSV_PATH) return path.join(path.dirname(process.env.CONTACT_CSV_PATH), "details");
  return path.join(os.tmpdir(), "contact-details");
}

function sanitizeId(value) {
  return String(value).replace(/[^a-zA-Z0-9_.-]/g, "");
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
