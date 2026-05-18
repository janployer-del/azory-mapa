import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_NOTION_VERSION = "2025-09-03";
const DEFAULT_DATA_SOURCE_ID = "345351be-095e-816f-9208-000b1bafe958";
const DEFAULT_OUTPUT_PATH = path.resolve("D:/Codex/Azory/Mapa/data/notion-web-sync.json");

const PROPERTY_TITLE = "N\u00e1zev";
const PROPERTY_COORDINATES = "Sou\u0159adnice";
const PROPERTY_TYPE = "Typ z\u00e1znamu";
const PROPERTY_THEME = "T\u00e9ma";
const PROPERTY_PHASE = "F\u00e1ze cesty";
const PROPERTY_VISIT_DATE = "Den kdy nav\u0161t\u00edvit";
const PROPERTY_RESERVE_BY = "Rezervovat do";
const PROPERTY_MAPY_URL = "Odkaz mapy CZ";
const PROPERTY_IS_NEW = "Nov\u00e9";
const PROPERTY_UPDATE_ON_WEB = "Aktualizovat na webu";

function parseArgs(argv) {
  const options = {
    dataSourceId: DEFAULT_DATA_SOURCE_ID,
    outputPath: DEFAULT_OUTPUT_PATH,
    notionVersion: DEFAULT_NOTION_VERSION,
    stdout: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--stdout") {
      options.stdout = true;
      continue;
    }

    if (arg === "--data-source-id") {
      options.dataSourceId = argv[index + 1] || "";
      index += 1;
      continue;
    }

    if (arg === "--output") {
      options.outputPath = path.resolve(argv[index + 1] || "");
      index += 1;
      continue;
    }

    if (arg === "--notion-version") {
      options.notionVersion = argv[index + 1] || "";
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.dataSourceId) {
    throw new Error("Missing value for --data-source-id");
  }

  if (!options.notionVersion) {
    throw new Error("Missing value for --notion-version");
  }

  if (!options.stdout && !options.outputPath) {
    throw new Error("Missing value for --output");
  }

  return options;
}

function readToken() {
  const token = process.env.NOTION_TOKEN?.trim();
  if (!token) {
    throw new Error("Environment variable NOTION_TOKEN is required.");
  }
  return token;
}

async function notionFetchJson(url, { token, notionVersion, body }) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": notionVersion,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Notion API request failed (${response.status} ${response.statusText}): ${errorText}`);
  }

  return response.json();
}

function propertyValue(page, propertyName) {
  return page.properties?.[propertyName] ?? null;
}

function titleToText(property) {
  if (!property || !Array.isArray(property.title)) return "";
  return property.title.map((item) => item.plain_text || "").join("").trim();
}

function richTextToText(property) {
  if (!property || !Array.isArray(property.rich_text)) return "";
  return property.rich_text.map((item) => item.plain_text || "").join("").trim();
}

function selectToText(property) {
  return property?.select?.name || "";
}

function checkboxToBoolean(property) {
  return Boolean(property?.checkbox);
}

function dateToIso(property) {
  return property?.date?.start || "";
}

function urlToText(property) {
  return property?.url || "";
}

function formulaToText(property) {
  const formula = property?.formula;
  if (!formula) return "";

  if (formula.type === "string") return formula.string || "";
  if (formula.type === "number") return formula.number == null ? "" : String(formula.number);
  if (formula.type === "boolean") return formula.boolean ? "true" : "false";
  if (formula.type === "date") return formula.date?.start || "";
  return "";
}

function textLikeToString(property) {
  if (!property) return "";

  switch (property.type) {
    case "title":
      return titleToText(property);
    case "rich_text":
      return richTextToText(property);
    case "url":
      return urlToText(property);
    case "select":
      return selectToText(property);
    case "date":
      return dateToIso(property);
    case "formula":
      return formulaToText(property);
    default:
      return "";
  }
}

function normalizePage(page) {
  return {
    title: titleToText(propertyValue(page, PROPERTY_TITLE)),
    url: page.url || "",
    notionUrl: page.url || "",
    [PROPERTY_COORDINATES]: textLikeToString(propertyValue(page, PROPERTY_COORDINATES)),
    [PROPERTY_TYPE]: selectToText(propertyValue(page, PROPERTY_TYPE)),
    [PROPERTY_THEME]: selectToText(propertyValue(page, PROPERTY_THEME)),
    [PROPERTY_PHASE]: selectToText(propertyValue(page, PROPERTY_PHASE)),
    [PROPERTY_VISIT_DATE]: dateToIso(propertyValue(page, PROPERTY_VISIT_DATE)),
    [PROPERTY_RESERVE_BY]: dateToIso(propertyValue(page, PROPERTY_RESERVE_BY)),
    [PROPERTY_MAPY_URL]: textLikeToString(propertyValue(page, PROPERTY_MAPY_URL)),
    [PROPERTY_IS_NEW]: checkboxToBoolean(propertyValue(page, PROPERTY_IS_NEW)),
    [PROPERTY_UPDATE_ON_WEB]: checkboxToBoolean(propertyValue(page, PROPERTY_UPDATE_ON_WEB)),
    lastEditedTime: page.last_edited_time || "",
    createdTime: page.created_time || ""
  };
}

async function queryCheckedPages({ token, dataSourceId, notionVersion }) {
  const pages = [];
  let nextCursor = undefined;

  do {
    const payload = {
      page_size: 100,
      filter: {
        property: PROPERTY_UPDATE_ON_WEB,
        checkbox: {
          equals: true
        }
      },
      sorts: [
        {
          timestamp: "last_edited_time",
          direction: "descending"
        }
      ]
    };

    if (nextCursor) {
      payload.start_cursor = nextCursor;
    }

    const response = await notionFetchJson(
      `https://api.notion.com/v1/data_sources/${dataSourceId}/query`,
      {
        token,
        notionVersion,
        body: payload
      }
    );

    pages.push(...(response.results || []));
    nextCursor = response.has_more ? response.next_cursor : undefined;
  } while (nextCursor);

  return pages;
}

async function writeOutput(outputPath, payload) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const token = readToken();
  const pages = await queryCheckedPages({
    token,
    dataSourceId: options.dataSourceId,
    notionVersion: options.notionVersion
  });

  const items = pages.map(normalizePage);
  const payload = {
    generatedAt: new Date().toISOString(),
    source: {
      dataSourceId: options.dataSourceId,
      notionVersion: options.notionVersion,
      filter: {
        property: PROPERTY_UPDATE_ON_WEB,
        checkboxEquals: true
      }
    },
    count: items.length,
    items
  };

  if (!options.stdout) {
    await writeOutput(options.outputPath, payload);
    console.error(`Saved ${items.length} items to ${options.outputPath}`);
  }

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
