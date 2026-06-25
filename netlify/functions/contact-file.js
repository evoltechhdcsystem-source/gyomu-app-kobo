const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const { connectLambda, getStore } = require("@netlify/blobs");
const { GetObjectCommand, S3Client } = require("@aws-sdk/client-s3");

const SUBMISSION_STORE_NAME = "private-contact-details";
const UPLOAD_STORE_NAME = "private-contact-uploads";
const CSV_FILE_NAME = "contact-submissions.csv";
const CSV_STORE_NAME = "private-contact-submissions";

exports.handler = async (event) => {
  connectLambda(event);

  if (!isAuthorized(event)) {
    return textResponse(403, "Forbidden");
  }

  const id = sanitizeId(event.queryStringParameters?.id || "");
  const fileIndex = Number(event.queryStringParameters?.file || -1);

  if (!id || !Number.isInteger(fileIndex) || fileIndex < 0) {
    return textResponse(400, "Bad Request");
  }

  try {
    const detail = await loadDetail(id);
    const file = detail?.files?.[fileIndex];

    if (!file) {
      return textResponse(404, "Not Found");
    }

    const bytes = await loadFileBytes(file);
    const fileName = encodeURIComponent(file.fileName).replace(/['()]/g, escape);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": file.mimeType || "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${fileName}`,
      },
      body: Buffer.from(bytes).toString("base64"),
      isBase64Encoded: true,
    };
  } catch (error) {
    console.error("contact-file failed", error);
    return textResponse(500, "File download failed");
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
    submission_id: row.submission_id || id,
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

async function loadFileBytes(file) {
  if (file.storageType === "file" && file.savedPath) {
    return fs.readFile(file.savedPath);
  }

  if (file.storageType === "s3") {
    const s3 = getS3Client();
    const bucket = file.s3Bucket || process.env.CONTACT_UPLOAD_BUCKET;
    const key = file.s3Key || parseS3SavedPath(file.savedPath).key;
    if (!bucket || !key) throw new Error("S3 file location is missing");

    const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return streamToBuffer(response.Body);
  }

  const store = getBlobStore(UPLOAD_STORE_NAME);
  const data = await store.get(file.blobKey, { type: "arrayBuffer" });
  if (!data) throw new Error("Blob not found");
  return Buffer.from(data);
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

function getS3Client() {
  const region = process.env.CONTACT_AWS_REGION || process.env.AWS_REGION || "ap-northeast-1";
  const accessKeyId = process.env.CONTACT_AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CONTACT_AWS_SECRET_ACCESS_KEY;
  const config = { region };

  if (accessKeyId && secretAccessKey) {
    config.credentials = { accessKeyId, secretAccessKey };
  }

  return new S3Client(config);
}

async function streamToBuffer(stream) {
  if (Buffer.isBuffer(stream)) return stream;
  if (stream instanceof Uint8Array) return Buffer.from(stream);
  if (typeof stream?.transformToByteArray === "function") {
    return Buffer.from(await stream.transformToByteArray());
  }

  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function parseS3SavedPath(savedPath) {
  const match = String(savedPath || "").match(/^s3:\/\/([^/]+)\/(.+)$/);
  return match ? { bucket: match[1], key: match[2] } : { bucket: "", key: "" };
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
    const s3Path = parseS3SavedPath(savedPath);
    return {
      fileName: match[1],
      mimeType: match[2],
      size: Number(match[3] || 0),
      savedPath,
      blobKey: savedPath.startsWith("netlify-blob://")
        ? savedPath.replace(/^netlify-blob:\/\/private-contact-uploads\//, "")
        : "",
      s3Bucket: s3Path.bucket,
      s3Key: s3Path.key,
      storageType: savedPath.startsWith("s3://")
        ? "s3"
        : savedPath.startsWith("netlify-blob://") ? "blob" : "file",
    };
  });
}

function textResponse(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
    body,
  };
}
