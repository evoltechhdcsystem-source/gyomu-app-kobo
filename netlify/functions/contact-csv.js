const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const { getStore } = require("@netlify/blobs");

const CSV_FILE_NAME = "contact-submissions.csv";
const CSV_STORE_NAME = "private-contact-submissions";

exports.handler = async (event) => {
  if (!isAuthorized(event)) {
    return textResponse(403, "Forbidden");
  }

  try {
    const csv = await loadCsv();

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${CSV_FILE_NAME}"`,
      },
      body: csv,
    };
  } catch (error) {
    console.error("contact-csv failed", error);
    return textResponse(500, "CSV download failed");
  }
};

async function loadCsv() {
  const csvPath = process.env.NETLIFY ? "" : process.env.CONTACT_CSV_PATH || defaultLocalCsvPath();

  if (csvPath) {
    return fs.readFile(csvPath, "utf8");
  }

  const store = getBlobStore(CSV_STORE_NAME);
  const csv = await store.get(CSV_FILE_NAME, { type: "text" });
  return csv || "";
}

function isAuthorized(event) {
  const expected = process.env.CONTACT_VIEW_TOKEN || (process.env.NETLIFY ? "" : "local-dev");
  const actual = event.queryStringParameters?.token || "";
  return Boolean(expected) && actual === expected;
}

function defaultLocalCsvPath() {
  if (process.env.NETLIFY) return "";
  return path.join(os.tmpdir(), CSV_FILE_NAME);
}

function getBlobStore(name) {
  return getStore({ name, consistency: "strong" });
}

function textResponse(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
    body,
  };
}
