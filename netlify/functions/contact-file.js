const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const { getStore } = require("@netlify/blobs");

const SUBMISSION_STORE_NAME = "private-contact-details";
const UPLOAD_STORE_NAME = "private-contact-uploads";

exports.handler = async (event) => {
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
  const detailDir = process.env.NETLIFY ? "" : process.env.CONTACT_DETAIL_DIR || defaultLocalDetailDir();

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
  return json ? JSON.parse(json) : null;
}

async function loadFileBytes(file) {
  if (file.storageType === "file" && file.savedPath) {
    return fs.readFile(file.savedPath);
  }

  const store = getBlobStore(UPLOAD_STORE_NAME);
  const data = await store.get(file.blobKey, { type: "arrayBuffer" });
  if (!data) throw new Error("Blob not found");
  return Buffer.from(data);
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

function getBlobStore(name) {
  return getStore({ name, consistency: "strong" });
}

function sanitizeId(value) {
  return String(value).replace(/[^a-zA-Z0-9_.-]/g, "");
}

function textResponse(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
    body,
  };
}
