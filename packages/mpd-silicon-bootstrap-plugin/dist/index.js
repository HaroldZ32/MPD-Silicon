// src/index.ts
import { readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rowLogLine, dshSeamInject, DSH_SEAM_SKILLS } from "@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/dist/index.js";
var name = "mpd-silicon-bootstrap";
var inject = [...dshSeamInject(DSH_SEAM_SKILLS), "mpdDsh"];
var PROVIDER_NAME = "silicon-bundle";
var BUNDLED_SKILL_RANK = 600;
var SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
function bundleRoot() {
  const here = dirname(fileURLToPath(import.meta.url));
  return dirname(dirname(dirname(here)));
}
function warn(ctx, message) {
  try {
    if (ctx.logger && typeof ctx.logger.warn === "function")
      ctx.logger.warn(message);
    else
      rowLogLine("mpd-silicon-bootstrap", "[mpd-silicon-bootstrap] " + message);
  } catch {}
}
function readVersion(root) {
  try {
    const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))?.version;
    return typeof version === "string" && version.length > 0 ? version : "unknown";
  } catch {
    return "unknown";
  }
}
function isAbsent(error) {
  const code = error?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}
function parseFrontmatter(raw) {
  const firstLineEnd = raw.indexOf(`
`);
  if (firstLineEnd < 0)
    return;
  if (raw.slice(0, firstLineEnd).replace(/\r$/, "") !== "---")
    return;
  let lineStart = firstLineEnd + 1;
  let closingStart = -1;
  let bodyStart = -1;
  while (lineStart <= raw.length) {
    const nextNewline = raw.indexOf(`
`, lineStart);
    const lineEnd = nextNewline < 0 ? raw.length : nextNewline;
    if (raw.slice(lineStart, lineEnd).replace(/\r$/, "") === "---") {
      closingStart = lineStart;
      bodyStart = nextNewline < 0 ? raw.length : nextNewline + 1;
      break;
    }
    if (nextNewline < 0)
      return;
    lineStart = nextNewline + 1;
  }
  if (closingStart < 0)
    return;
  return { data: parseYamlBlock(raw.slice(firstLineEnd + 1, closingStart)), body: raw.slice(bodyStart) };
}
function parseScalar(value) {
  const text = value.trim();
  if (text === "")
    return "";
  if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) {
    try {
      return JSON.parse(text);
    } catch {
      return text.slice(1, -1);
    }
  }
  if (text.startsWith("'") && text.endsWith("'") && text.length >= 2)
    return text.slice(1, -1).replace(/''/g, "'");
  const lower = text.toLowerCase();
  if (lower === "true" || lower === "yes" || lower === "on")
    return true;
  if (lower === "false" || lower === "no" || lower === "off")
    return false;
  if (lower === "null" || text === "~")
    return null;
  if (/^-?\d+$/.test(text))
    return Number(text);
  if (/^-?\d*\.\d+$/.test(text))
    return Number(text);
  return text;
}
function foldLines(lines) {
  let out = "";
  for (const line of lines) {
    if (line === "")
      out += `
`;
    else
      out += (out === "" || out.endsWith(`
`) ? "" : " ") + line;
  }
  return out;
}
function parseYamlBlock(text) {
  const lines = text.split(`
`);
  const root = {};
  const stack = [{ indent: -1, map: root }];
  let index = 0;
  while (index < lines.length) {
    const raw = lines[index];
    index += 1;
    if (raw.trim() === "" || raw.trimStart().startsWith("#"))
      continue;
    const indent = raw.length - raw.trimStart().length;
    const line = raw.slice(indent);
    const match = /^([A-Za-z0-9_][A-Za-z0-9_.-]*)\s*:(?:[ \t]+(.*))?$/.exec(line);
    if (match === null)
      throw new Error("unsupported frontmatter line: " + line);
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent)
      stack.pop();
    const parent = stack[stack.length - 1].map;
    const key = match[1];
    const rest = match[2] ?? "";
    if (rest.trim() === "") {
      let next;
      for (let probe = index;probe < lines.length; probe += 1) {
        const candidate = lines[probe];
        if (candidate.trim() === "" || candidate.trimStart().startsWith("#"))
          continue;
        next = { indent: candidate.length - candidate.trimStart().length, text: candidate.trimStart() };
        break;
      }
      if (next !== undefined && next.indent > indent && /^[A-Za-z0-9_][A-Za-z0-9_.-]*\s*:/.test(next.text)) {
        const child = {};
        parent[key] = child;
        stack.push({ indent, map: child });
      } else
        parent[key] = null;
      continue;
    }
    const block = /^([|>])([+-]?)(\d*)$/.exec(rest.trim());
    if (block !== null) {
      const collected = [];
      let blockIndent = -1;
      while (index < lines.length) {
        const candidate = lines[index];
        if (candidate.trim() === "") {
          collected.push("");
          index += 1;
          continue;
        }
        const candidateIndent = candidate.length - candidate.trimStart().length;
        if (candidateIndent <= indent)
          break;
        if (blockIndent < 0)
          blockIndent = candidateIndent;
        collected.push(candidate.slice(Math.min(blockIndent, candidateIndent)));
        index += 1;
      }
      while (collected.length > 0 && collected[collected.length - 1] === "")
        collected.pop();
      const joined = block[1] === "|" ? collected.join(`
`) : foldLines(collected);
      parent[key] = block[2] === "-" ? joined.replace(/\n+$/, "") : joined;
      continue;
    }
    parent[key] = parseScalar(rest);
  }
  return root;
}
function stringField(data, key) {
  const value = data[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
function frontmatterBoolean(data, key) {
  if (!Object.hasOwn(data, key))
    return;
  const value = data[key];
  if (typeof value === "boolean")
    return value;
  if (value === 1 || value === "1")
    return true;
  if (value === 0 || value === "0")
    return false;
  if (typeof value === "string") {
    switch (value.toLowerCase()) {
      case "true":
      case "yes":
      case "on":
        return true;
      case "false":
      case "no":
      case "off":
        return false;
    }
  }
  throw new TypeError(`frontmatter field "${key}" must be a boolean`);
}
function parseInvocation(data) {
  for (const legacy of ["disableModelInvocation", "modelInvocable", "userInvocable"]) {
    if (Object.hasOwn(data, legacy))
      throw new Error(`frontmatter field "${legacy}" is unsupported; use "${legacy === "userInvocable" ? "user-invocable" : "disable-model-invocation"}"`);
  }
  return {
    modelInvocable: frontmatterBoolean(data, "disable-model-invocation") !== true,
    userInvocable: frontmatterBoolean(data, "user-invocable") !== false
  };
}
async function readSkillFile(filePath, ctx) {
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (isAbsent(error))
      return;
    throw error;
  }
  let parsed;
  try {
    parsed = parseFrontmatter(raw);
  } catch (error) {
    warn(ctx, `skill file ${filePath} ignored: invalid frontmatter: ${String(error?.message ?? error)}`);
    return;
  }
  if (parsed === undefined) {
    warn(ctx, `skill file ${filePath} ignored: missing YAML frontmatter`);
    return;
  }
  const skillName = stringField(parsed.data, "name");
  const description = stringField(parsed.data, "description");
  if (skillName === undefined || description === undefined) {
    warn(ctx, `skill file ${filePath} ignored: frontmatter requires name and description`);
    return;
  }
  if (!SKILL_NAME.test(skillName)) {
    warn(ctx, `skill file ${filePath} ignored: invalid skill name "${skillName}"`);
    return;
  }
  let invocation;
  try {
    invocation = parseInvocation(parsed.data);
  } catch (error) {
    warn(ctx, `skill file ${filePath} ignored: ${String(error?.message ?? error)}`);
    return;
  }
  const metadata = parsed.data.metadata;
  return {
    name: skillName,
    description,
    ...stringField(parsed.data, "whenToUse") !== undefined ? { whenToUse: stringField(parsed.data, "whenToUse") } : {},
    invocation,
    ...typeof metadata === "object" && metadata !== null && !Array.isArray(metadata) ? { metadata } : {},
    content: parsed.body.trim()
  };
}
async function listCorpus(root) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true, encoding: "utf8" });
  } catch (error) {
    if (isAbsent(error))
      return [];
    throw error;
  }
  const found = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name === ".system")
      continue;
    if (entry.isDirectory())
      found.push({ entry: entry.name, locator: join(root, entry.name, "SKILL.md"), directory: join(root, entry.name) });
    else if (entry.isFile() && entry.name.endsWith(".md"))
      found.push({ entry: entry.name, locator: join(root, entry.name), directory: root });
  }
  return found;
}
function createProvider(root, ctx, invalidate, adapter) {
  const provider = {
    name: PROVIDER_NAME,
    async list() {
      const candidates = [];
      for (const entry of await listCorpus(root)) {
        const parsed = await readSkillFile(entry.locator, ctx);
        if (parsed === undefined)
          continue;
        candidates.push({
          name: parsed.name,
          description: parsed.description,
          ...parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {},
          invocation: parsed.invocation,
          provider: PROVIDER_NAME,
          source: "bundled",
          rank: BUNDLED_SKILL_RANK,
          locator: { path: entry.locator, directory: entry.directory },
          resourceBase: { kind: "directory", path: entry.directory },
          path: entry.locator,
          ...parsed.metadata !== undefined ? { metadata: parsed.metadata } : {}
        });
      }
      return candidates;
    },
    async get(candidate) {
      const parsed = await readSkillFile(candidate?.locator?.path ?? "", ctx);
      if (parsed === undefined)
        return;
      return {
        name: parsed.name,
        description: parsed.description,
        ...parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {},
        invocation: parsed.invocation,
        provider: PROVIDER_NAME,
        source: "bundled",
        resourceBase: candidate.resourceBase ?? { kind: "directory", path: dirname(candidate?.locator?.path ?? "") },
        path: candidate?.locator?.path,
        ...parsed.metadata !== undefined ? { metadata: parsed.metadata } : {},
        content: parsed.content
      };
    }
  };
  if (typeof adapter.onEvent === "function") {
    adapter.onEvent("fs/observed", (target, _observation, actor) => {
      const toolName = actor?.name;
      if (toolName !== "edit" && toolName !== "write")
        return;
      const displayPath = typeof target?.displayPath === "string" ? target.displayPath : undefined;
      if (displayPath === undefined || !displayPath.startsWith(root))
        return;
      invalidate();
    });
  }
  return provider;
}
function apply(ctx, config = {}) {
  const adapter = ctx.mpdDsh;
  const root = bundleRoot();
  const corpus = config.skillsDir ? config.skillsDir : join(root, "skills");
  if (config.skipSkills === true) {
    console.log("[mpd-silicon-bootstrap] skill corpus provider skipped (config)");
    return;
  }
  adapter.registerSkillProvider((control) => createProvider(corpus, ctx, () => control?.invalidate?.(), adapter));
  console.log("[mpd-silicon-bootstrap] skill corpus served from " + corpus + " (provider " + PROVIDER_NAME + ", bundle " + readVersion(root) + ")");
}
export {
  BUNDLED_SKILL_RANK,
  PROVIDER_NAME,
  apply,
  bundleRoot,
  createProvider,
  inject,
  listCorpus,
  name,
  parseFrontmatter,
  parseInvocation,
  readSkillFile
};
