const Busboy = require("busboy");
const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const { getStore } = require("@netlify/blobs");

const CSV_FILE_NAME = "contact-submissions.csv";
const UPLOAD_STORE_NAME = "private-contact-uploads";
const SUBMISSION_STORE_NAME = "private-contact-details";
const CSV_HEADERS = [
  "received_at",
  "submission_id",
  "name",
  "company",
  "email",
  "message",
  "privacy_consent",
  "attachments",
  "inquiry_url",
  "ip_address",
  "user_agent",
];

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { ok: false, message: "Method not allowed" });
  }

  let stage = "start";

  try {
    stage = "parseMultipartForm";
    const submission = await parseMultipartForm(event);
    stage = "validateSubmission";
    const requiredError = validateSubmission(submission.fields);

    if (requiredError) {
      return jsonResponse(400, { ok: false, message: requiredError });
    }

    const receivedAt = new Date().toISOString();
    const submissionId = buildSubmissionId(receivedAt);
    stage = "saveUploadedFiles";
    const savedFiles = await saveUploadedFiles(submission.files, receivedAt, submissionId);
    const row = {
      received_at: receivedAt,
      submission_id: submissionId,
      name: submission.fields.name || "",
      company: submission.fields.company || "",
      email: submission.fields.email || "",
      message: submission.fields.message || "",
      privacy_consent: submission.fields.privacyConsent === "on" ? "yes" : "no",
      attachments: savedFiles.map(formatAttachment).join(" / "),
      attachment_names: savedFiles.map(formatAttachmentName).join(" / "),
      inquiry_url: buildInquiryUrl(event, submissionId),
      ip_address: event.headers["x-nf-client-connection-ip"] || event.headers["client-ip"] || "",
      user_agent: event.headers["user-agent"] || "",
    };

    stage = "saveSubmissionDetail";
    await saveSubmissionDetail({ ...row, files: savedFiles.map(fileForJson) });
    stage = "appendCsvRow";
    await appendCsvRow(row);
    stage = "notifyLineWorks";
    try {
      await notifyLineWorks(row);
    } catch (error) {
      console.error("contact notification failed", {
        submissionId,
        error: error?.message || String(error),
      });
    }

    return jsonResponse(200, { ok: true, message: "accepted" });
  } catch (error) {
    console.error("contact-submit failed", {
      stage,
      error: error?.message || String(error),
      stack: error?.stack,
    });
    return jsonResponse(500, {
      ok: false,
      message: "送信処理に失敗しました。時間をおいて再度お試しください。",
    });
  }
};

function parseMultipartForm(event) {
  return new Promise((resolve, reject) => {
    const contentType = event.headers["content-type"] || event.headers["Content-Type"];

    if (!contentType || !contentType.includes("multipart/form-data")) {
      reject(new Error("Expected multipart/form-data"));
      return;
    }

    const fields = {};
    const files = [];
    const busboy = Busboy({
      headers: { "content-type": contentType },
      defCharset: "utf8",
      defParamCharset: "utf8",
    });

    busboy.on("field", (name, value) => {
      fields[name] = value;
    });

    busboy.on("file", (name, stream, info) => {
      let size = 0;
      const chunks = [];
      stream.on("data", (chunk) => {
        size += chunk.length;
        chunks.push(chunk);
      });
      stream.on("end", () => {
        if (info.filename) {
          files.push({
            fieldName: name,
            fileName: info.filename,
            mimeType: info.mimeType,
            size,
            buffer: Buffer.concat(chunks),
          });
        }
      });
    });

    busboy.on("error", reject);
    busboy.on("finish", () => resolve({ fields, files }));

    const body = Buffer.from(event.body || "", event.isBase64Encoded ? "base64" : "utf8");
    busboy.end(body);
  });
}

function validateSubmission(fields) {
  if (!String(fields.name || "").trim()) return "お名前を入力してください。";
  if (!String(fields.email || "").trim()) return "メールアドレスを入力してください。";
  if (fields.privacyConsent !== "on") return "個人情報の取り扱いへの同意をお願いします。";
  return "";
}

async function appendCsvRow(row) {
  const line = `${CSV_HEADERS.map((header) => csvCell(row[header])).join(",")}\n`;
  const csvPath = process.env.CONTACT_CSV_PATH;

  if (csvPath) {
    await fs.mkdir(path.dirname(csvPath), { recursive: true });
    const prefix = await ensureCsvFilePrefix(csvPath);
    await fs.appendFile(csvPath, `${prefix}${line}`, "utf8");
    return;
  }

  try {
    const store = getBlobStore("private-contact-submissions");
    const current = await store.get(CSV_FILE_NAME, { type: "text" });
    await store.set(CSV_FILE_NAME, `${normalizeCsvText(current)}${line}`, {
      metadata: { contentType: "text/csv; charset=utf-8" },
    });
  } catch (error) {
    if (process.env.NETLIFY) {
      throw error;
    }

    const fallbackPath = path.join(os.tmpdir(), CSV_FILE_NAME);
    const prefix = await ensureCsvFilePrefix(fallbackPath);
    await fs.appendFile(fallbackPath, `${prefix}${line}`, "utf8");
    console.warn(`Netlify Blobs unavailable. Wrote CSV to temporary path: ${fallbackPath}`, error);
  }
}

async function saveUploadedFiles(files, receivedAt, submissionId) {
  if (!files.length) return [];

  const uploadDir = process.env.CONTACT_UPLOAD_DIR || defaultLocalUploadDir();

  if (uploadDir) {
    await fs.mkdir(uploadDir, { recursive: true });
    return Promise.all(files.map(async (file, index) => {
      const fileName = buildStoredFileName(file.fileName, receivedAt, index);
      const savedPath = path.join(uploadDir, submissionId, fileName);
      await fs.mkdir(path.dirname(savedPath), { recursive: true });
      await fs.writeFile(savedPath, file.buffer);
      return { ...file, savedPath, storageType: "file" };
    }));
  }

  try {
    const store = getBlobStore(UPLOAD_STORE_NAME);
    return Promise.all(files.map(async (file, index) => {
      const key = `${submissionId}/${buildStoredFileName(file.fileName, receivedAt, index)}`;
      await store.set(key, file.buffer, {
        metadata: { contentType: file.mimeType || "application/octet-stream" },
      });
      return { ...file, blobKey: key, savedPath: `netlify-blob://${UPLOAD_STORE_NAME}/${key}`, storageType: "blob" };
    }));
  } catch (error) {
    if (process.env.NETLIFY) {
      throw error;
    }

    const fallbackDir = path.join(os.tmpdir(), "contact-uploads");
    await fs.mkdir(fallbackDir, { recursive: true });
    const savedFiles = await Promise.all(files.map(async (file, index) => {
      const fileName = buildStoredFileName(file.fileName, receivedAt, index);
      const savedPath = path.join(fallbackDir, submissionId, fileName);
      await fs.mkdir(path.dirname(savedPath), { recursive: true });
      await fs.writeFile(savedPath, file.buffer);
      return { ...file, savedPath, storageType: "file" };
    }));
    console.warn(`Netlify Blobs unavailable. Wrote uploads to temporary path: ${fallbackDir}`, error);
    return savedFiles;
  }
}

async function saveSubmissionDetail(detail) {
  const json = JSON.stringify(detail, null, 2);
  const detailDir = process.env.CONTACT_DETAIL_DIR || defaultLocalDetailDir();

  if (detailDir) {
    await fs.mkdir(detailDir, { recursive: true });
    await fs.writeFile(path.join(detailDir, `${detail.submission_id}.json`), json, "utf8");
    return;
  }

  const store = getBlobStore(SUBMISSION_STORE_NAME);
  await store.set(`${detail.submission_id}.json`, json, {
    metadata: { contentType: "application/json; charset=utf-8" },
  });
}

function defaultLocalUploadDir() {
  if (process.env.NETLIFY) return "";
  if (process.env.CONTACT_CSV_PATH) return path.join(path.dirname(process.env.CONTACT_CSV_PATH), "uploads");
  return path.join(os.tmpdir(), "contact-uploads");
}

function defaultLocalDetailDir() {
  if (process.env.NETLIFY) return "";
  if (process.env.CONTACT_CSV_PATH) return path.join(path.dirname(process.env.CONTACT_CSV_PATH), "details");
  return path.join(os.tmpdir(), "contact-details");
}

function getBlobStore(name) {
  return getStore({ name, consistency: "strong" });
}

async function notifyLineWorks(row) {
  const webhookUrl = process.env.LINEWORKS_WEBHOOK_URL;

  if (!webhookUrl) {
    console.warn("LINEWORKS_WEBHOOK_URL is not set. Skipped LINE WORKS notification.");
    return;
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "お問い合わせが届きました",
      body: {
        text: [
          "Webサイトからお問い合わせが届きました。",
          "",
          `お名前: ${row.name}`,
          `会社名: ${row.company || "-"}`,
          `メール: ${row.email}`,
          `添付ファイル: ${row.attachment_names || "-"}`,
          "",
          `内容プレビュー: ${safeLineWorksText(row.message || "-", 120)}`,
        ].join("\n"),
      },
      ...(row.inquiry_url ? {
        button: {
          label: "問い合わせを確認",
          url: row.inquiry_url,
        },
      } : {}),
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LINE WORKS webhook failed: ${response.status} ${text}`);
  }
}

function fileForJson(file) {
  return {
    fieldName: file.fieldName,
    fileName: file.fileName,
    mimeType: file.mimeType,
    size: file.size,
    savedPath: file.savedPath,
    blobKey: file.blobKey || "",
    storageType: file.storageType,
  };
}

function safeLineWorksText(value, maxLength = 200) {
  const text = String(value)
    .replace(/[\\/"'`<>]/g, " ")
    .replace(/[#@]/g, " ")
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return "-";
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function formatAttachment(file) {
  return `${file.fileName} (${file.mimeType || "unknown"}, ${file.size} bytes, ${file.savedPath})`;
}

function formatAttachmentName(file) {
  return `${file.fileName} (${file.size} bytes)`;
}

function buildStoredFileName(originalName, receivedAt, index) {
  const parsed = path.parse(originalName);
  const safeBase = sanitizeFileName(parsed.name || "attachment");
  const safeExt = sanitizeFileName(parsed.ext || "");
  const timestamp = receivedAt.replace(/[:.]/g, "-");
  return `${timestamp}-${String(index + 1).padStart(2, "0")}-${safeBase}${safeExt}`;
}

function buildSubmissionId(receivedAt) {
  const timestamp = receivedAt.replace(/[:.]/g, "-");
  const random = Math.random().toString(36).slice(2, 10);
  return `${timestamp}-${random}`;
}

function buildInquiryUrl(event, submissionId) {
  const token = process.env.CONTACT_VIEW_TOKEN || (process.env.NETLIFY ? "" : "local-dev");
  if (!token) return "";

  const host = event.headers["x-forwarded-host"] || event.headers.host;
  if (!host) return "";

  const proto = host.includes("localhost") || host.startsWith("127.0.0.1")
    ? "http"
    : event.headers["x-forwarded-proto"] || "https";
  const params = new URLSearchParams({ id: submissionId, token });
  return `${proto}://${host}/.netlify/functions/contact-detail?${params.toString()}`;
}

function sanitizeFileName(value) {
  return String(value)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120);
}

function csvHeaderLine() {
  return `\ufeff${CSV_HEADERS.join(",")}\n`;
}

async function ensureCsvFilePrefix(csvPath) {
  try {
    const content = await fs.readFile(csvPath, "utf8");
    if (!content) return csvHeaderLine();
    const normalized = normalizeCsvText(content);
    if (normalized !== content) {
      await fs.writeFile(csvPath, normalized, "utf8");
    }
    return "";
  } catch (error) {
    if (error.code === "ENOENT") return csvHeaderLine();
    throw error;
  }
}

function normalizeCsvText(current) {
  if (!current) return csvHeaderLine();
  const withoutBom = current.charCodeAt(0) === 0xfeff ? current.slice(1) : current;
  const newlineIndex = withoutBom.indexOf("\n");
  const header = CSV_HEADERS.join(",");

  if (newlineIndex === -1) {
    return `\ufeff${header}\n`;
  }

  const firstLine = withoutBom.slice(0, newlineIndex).replace(/\r$/, "");
  const rest = withoutBom.slice(newlineIndex + 1);

  if (firstLine === header) {
    return `\ufeff${withoutBom}`;
  }

  return `\ufeff${header}\n${rest}`;
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""').replace(/\r?\n/g, "\n")}"`;
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  };
}
