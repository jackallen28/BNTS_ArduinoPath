// Loads the real parts library and content for the circuit tests.
import { readFileSync, readdirSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
export const readJSON = (path) => JSON.parse(readFileSync(new URL(path, root), "utf8"));

/** The part catalogue as loadParts() gives it (without the SVG text). */
export function catalogue() {
  const index = readJSON("ui/parts/index.json");
  const types = {};
  for (const t of index.parts) types[t] = readJSON(`ui/parts/${t}/part.json`);
  const boards = {};
  for (const b of index.boards) boards[b] = readJSON(`ui/parts/boards/${b}/board.json`);
  return { breadboard: readJSON("ui/parts/breadboard/breadboard.json"), types, boards };
}

export function boards() {
  return readdirSync(new URL("content/boards/", root)).filter((f) => f.endsWith(".json"))
    .map((f) => readJSON(`content/boards/${f}`));
}

export function projects() {
  return readdirSync(new URL("content/projects/", root)).filter((f) => f.endsWith(".json"))
    .map((f) => readJSON(`content/projects/${f}`));
}

/** Does a project list this board (by id or keyword)? */
export function supports(project, board) {
  return project.boards.some((k) => k === "all" || k === board.id || k === board.family ||
    (k === "esp" && board.family.startsWith("esp")));
}
