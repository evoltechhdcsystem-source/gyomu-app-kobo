const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const { connectLambda, getStore } = require("@netlify/blobs");

const CSV_FILE_NAME = "contact-submissions.csv";
const CSV_STORE_NAME = "private-contact-submissions";

exports.handler = async (event) => {
  connectLambda(event);

  if (!isAuthorized(event)) {
    return textResponse(403, "Forbidden");
  }

  try {
    const csv = ensureUtf8Bom(await loadCsv());

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/vnd.ms-excel; charset=utf-8",
        "Content-Disposition": `attachment; filename="${CSV_FILE_NAME}"`,
        "Cache-Control": "no-store",
      },
      body: csv,
    };
  } catch (error) {
    console.error("contact-csv failed", error);
    return textResponse(500, "CSV download failed");
  }
};

async function loadCsv() {
  const csvPath = isServerlessRuntime() ? "" : process.env.CONTACT_CSV_PATH || defaultLocalCsvPath();

  if (csvPath) {
    return fs.readFile(csvPath, "utf8");
  }

  const store = getBlobStore(CSV_STORE_NAME);
  const csv = await store.get(CSV_FILE_NAME, { type: "text" });
  return csv || "";
}

function isAuthorized(event) {
  const expected = process.env.CONTACT_VIEW_TOKEN || (isServerlessRuntime() ? "" : "local-dev");
  const actual = event.queryStringParameters?.token || "";
  return Boolean(expected) && actual === expected;
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

function ensureUtf8Bom(csv) {
  if (!csv) return "\ufeff";
  return csv.charCodeAt(0) === 0xfeff ? csv : `\ufeff${csv}`;
}

function textResponse(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
    body,
  };
}
