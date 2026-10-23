// Loads the parts library (ui/parts/, made by tools/import_fritzing):
// part.json and the SVG art of each part type, the breadboard and boards.
// Files are fetched once and kept for the page's lifetime.

const cache = new Map();

function defaultBase() {
  if (typeof document !== "undefined") return new URL("parts/", document.baseURI).href;
  return "parts/";
}

function get(url, kind, fetchFn) {
  if (!cache.has(url)) {
    cache.set(url, fetchFn(url).then((res) => {
      if (!res.ok) throw new Error(`Couldn't load ${url} (${res.status})`);
      return kind === "json" ? res.json() : res.text();
    }).catch((e) => { cache.delete(url); throw e; }));
  }
  return cache.get(url);
}

async function loadEntry(dir, jsonName, fetchFn, withSchematic = true) {
  const json = await get(`${dir}${jsonName}`, "json", fetchFn);
  const [bb, sch] = await Promise.all([
    get(`${dir}${json.breadboard?.file || "breadboard.svg"}`, "text", fetchFn),
    withSchematic && json.schematic ? get(`${dir}${json.schematic.file}`, "text", fetchFn) : null,
  ]);
  return { ...json, svg: { breadboard: bb, schematic: sch } };
}

/**
 * Loads the part catalogue the renderer and netlist need.
 * @param {{types?: string[], boards?: string[], base?: string, fetch?: typeof fetch}} opts
 * @returns {Promise<{base: string, breadboard: object, boards: Record<string, object>, types: Record<string, object>}>}
 *   Each entry is its JSON file plus `svg: {breadboard, schematic}` (SVG text).
 */
export async function loadParts({ types = [], boards = [], base = defaultBase(), fetch: fetchFn = globalThis.fetch } = {}) {
  if (!base.endsWith("/")) base += "/";
  const uniq = (a) => [...new Set(a.filter(Boolean))];
  const [breadboard, typeEntries, boardEntries] = await Promise.all([
    loadEntry(`${base}breadboard/`, "breadboard.json", fetchFn, false),
    Promise.all(uniq(types).map(async (t) => [t, await loadEntry(`${base}${t}/`, "part.json", fetchFn)])),
    Promise.all(uniq(boards).map(async (b) => [b, await loadEntry(`${base}boards/${b}/`, "board.json", fetchFn, false)])),
  ]);
  return { base, breadboard, types: Object.fromEntries(typeEntries), boards: Object.fromEntries(boardEntries) };
}

/**
 * Loads everything one circuit needs on one board.
 * @param {object} circuit  a project's circuit
 * @param {object|string} board  the board (content/boards JSON) or its id
 */
export function loadCircuitParts(circuit, board, opts = {}) {
  const types = (circuit?.parts || []).map((p) => p.type);
  return loadParts({ ...opts, types, boards: [typeof board === "string" ? board : board.id] });
}

/** Merges more parts into a catalogue (for Free Play's "Add a part"). */
export async function addParts(catalogue, { types = [], boards = [], fetch: fetchFn } = {}) {
  const more = await loadParts({ types, boards, base: catalogue.base, fetch: fetchFn });
  Object.assign(catalogue.types, more.types);
  Object.assign(catalogue.boards, more.boards);
  return catalogue;
}
