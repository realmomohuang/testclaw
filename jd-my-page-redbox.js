/*
 * Quantumult X response-body script for JD "我的" page cleanup.
 * It removes JSON objects/array items whose own display text matches the
 * red-box modules seen in the user's Reqable capture target.
 */

const rawBody = typeof $response !== "undefined" && $response.body ? $response.body : "";
const requestUrl = typeof $request !== "undefined" && $request.url ? $request.url : "";
const requestBody = typeof $request !== "undefined" && $request.body ? $request.body : "";

function decodeLoose(text) {
  try {
    return decodeURIComponent(text);
  } catch (_) {
    return text;
  }
}

function pickParam(text, name) {
  const decoded = decodeLoose(text);
  const patterns = [
    new RegExp(`(?:^|[?&\\n])${name}=([^&\\n]+)`),
    new RegExp(`"${name}"\\s*:\\s*"([^"]+)"`),
  ];
  for (const pattern of patterns) {
    const match = decoded.match(pattern);
    if (match) return decodeLoose(match[1] || "");
  }
  return "";
}

const requestText = `${requestUrl}\n${requestBody}`;
const functionId = pickParam(requestText, "functionId");
const appid = pickParam(requestText, "appid");
const isSHomeLoad = functionId === "SHome_Load";

const isBasicConfig =
  functionId === "basicConfig" && appid === "avatar-basic-config";

const looksLikeBasicConfigBody =
  /"JDService"\s*:/.test(rawBody) ||
  /"JDNJMyWalletModule"\s*:/.test(rawBody) ||
  /"JDAD"\s*:/.test(rawBody) ||
  /"JDAdsCore"\s*:/.test(rawBody);

const TARGET_WORDS = [
  "钱包",
  "京东服务",
  "互动游戏",
  "白条",
  "京东借钱",
  "黄金",
  "京东快递",
  "家电回收",
  "刮卡领京豆",
  "赚红包",
  "天天赚京豆",
  "参与调研",
  "马士预约",
  "清刚经典款",
  "99T",
];

const DISPLAY_KEYS = /^(title|name|text|label|desc|description|content|subtitle|subTitle|floorName|moduleName|tabName|channelName|businessName|benefitText|rightText|leftText|buttonText)$/i;
const DROP_KEY_HINTS = /(wallet|baitiao|finance|jdfinance|gold|borrow|loan|service|game|interactive|survey|questionnaire|jdService|jingdongService)/i;

function hasTarget(text) {
  return TARGET_WORDS.some((word) => text.includes(word));
}

function parseEnvelope(body) {
  try {
    return { prefix: "", value: JSON.parse(body), suffix: "" };
  } catch (_) {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const jsonText = body.slice(start, end + 1);
      return {
        prefix: body.slice(0, start),
        value: JSON.parse(jsonText),
        suffix: body.slice(end + 1),
      };
    }
    throw new Error("not json");
  }
}

function ownDisplayText(obj) {
  const values = [];
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string" && DISPLAY_KEYS.test(key)) {
      values.push(value);
    }
  }
  return values.join(" ");
}

function maybeCleanJsonString(value, depth) {
  const text = value.trim();
  if (!text || !/^[\[{]/.test(text) || !hasTarget(text)) return value;
  try {
    const parsed = JSON.parse(text);
    const cleaned = clean(parsed, "", depth + 1);
    return JSON.stringify(cleaned);
  } catch (_) {
    return value;
  }
}

let removed = 0;

function cleanBasicConfig(root) {
  if (!root || typeof root !== "object" || !root.data || typeof root.data !== "object") return root;
  const keys = [
    "JDService",
    "JDNJMyWalletModule",
    "JDAD",
    "JDAdsCore",
  ];
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(root.data, key)) {
      delete root.data[key];
      removed += 1;
    }
  }
  return root;
}

function clean(value, parentKey, depth) {
  if (Array.isArray(value)) {
    const next = [];
    for (const item of value) {
      const cleaned = clean(item, parentKey, depth + 1);
      if (cleaned !== undefined) next.push(cleaned);
    }
    return next;
  }

  if (!value || typeof value !== "object") {
    if (typeof value === "string") return maybeCleanJsonString(value, depth);
    return value;
  }

  const shallowText = ownDisplayText(value);
  const hintMatched = isSHomeLoad && (DROP_KEY_HINTS.test(parentKey) || DROP_KEY_HINTS.test(shallowText));
  if (depth > 1 && (hasTarget(shallowText) || hintMatched)) {
    removed += 1;
    return undefined;
  }

  const next = {};
  for (const [key, child] of Object.entries(value)) {
    if (DROP_KEY_HINTS.test(key) && depth > 0) {
      const childText = typeof child === "string" ? child : JSON.stringify(child);
      if (hasTarget(childText) || key.length < 32) {
        removed += 1;
        continue;
      }
    }
    const cleaned = clean(child, key, depth + 1);
    if (cleaned !== undefined) next[key] = cleaned;
  }
  return next;
}

try {
  if (/api\.m\.jd\.com\/client\.action/.test(requestUrl)) {
    const hit = isBasicConfig || isSHomeLoad || looksLikeBasicConfigBody || hasTarget(rawBody);
    console.log(`[JD cleanup] functionId=${functionId || "-"} appid=${appid || "-"} responseLen=${rawBody.length} hit=${hit ? "1" : "0"}`);
  }

  if (!rawBody || (!isBasicConfig && !isSHomeLoad && !looksLikeBasicConfigBody && !hasTarget(rawBody))) {
    $done({ body: rawBody });
  } else {
    const parsed = parseEnvelope(rawBody);
    const cleaned = (isBasicConfig || looksLikeBasicConfigBody) ? cleanBasicConfig(parsed.value) : clean(parsed.value, "", 0);
    const nextBody = parsed.prefix + JSON.stringify(cleaned) + parsed.suffix;
    if (removed > 0) {
      console.log(`JD redbox cleanup removed ${removed} item(s) from ${requestUrl}`);
    }
    $done({ body: nextBody });
  }
} catch (error) {
  console.log(`JD redbox cleanup skipped: ${error.message}`);
  $done({ body: rawBody });
}
