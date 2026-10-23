// Real boards: compiling and uploading through ArduinoPath.exe / .app (which
// has the Arduino tools built in), finding the board's port, and the Serial
// Monitor connection.

import { api } from "./api.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Which family a board belongs to (for its tools). */
export function familyOf(board) {
  return board?.family ?? "avr";
}

/**
 * Runs a compile or upload job and waits for it, calling onUpdate with each
 * new state ({ state, progress, output, result, error }).
 */
async function runJob(start, onUpdate = () => {}) {
  const { id } = await start();
  let last = "";
  for (;;) {
    const job = await api.job(id);
    const key = `${job.state}:${job.progress}:${job.output?.length}`;
    if (key !== last) {
      last = key;
      onUpdate(job);
    }
    if (job.state === "done" || job.state === "failed") return job;
    await sleep(job.state === "uploading" ? 250 : 400);
  }
}

/** Compiles code for the student's board: the real compiler, the judge. */
export function compile(code, board, variant, onUpdate) {
  return runJob(() => api.compile(code, board.id, variant || ""), onUpdate);
}

/** Compiles and uploads code to the board on port. */
export function upload(code, board, variant, port, onUpdate) {
  return runJob(() => api.upload(code, board.id, variant || "", port), onUpdate);
}

/**
 * The best guess at the student's board: a port whose board matches, else
 * the only port, else null.
 */
export function guessPort(ports, board, remembered) {
  if (remembered && ports.some((p) => p.port === remembered)) return remembered;
  const match = ports.find((p) => p.fqbn && board && p.fqbn.startsWith(board.fqbn.split(":").slice(0, 3).join(":")));
  if (match) return match.port;
  return ports.length === 1 ? ports[0].port : null;
}

/** A friendly name for a port: "COM3 (CH340: most clone boards)". */
export function portLabel(p) {
  const chips = {
    CH340: "CH340: most clone boards",
    CP2102: "CP2102: NodeMCU, ESP32",
    FTDI: "FTDI",
    Arduino: "Arduino",
    "ESP32 USB": "ESP32 USB",
  };
  const what = p.board || chips[p.chip];
  return what ? `${p.port} (${what})` : p.port;
}

/**
 * The Serial Monitor for a real board. onData(text), onClose(reason).
 * Returns { write(text), close() }.
 */
export function openSerial(port, baud, { onData, onOpen = () => {}, onClose = () => {} }) {
  const es = new EventSource(`/api/serial?port=${encodeURIComponent(port)}&baud=${baud}`);
  let closed = false;
  const finish = (reason) => {
    if (closed) return;
    closed = true;
    es.close();
    onClose(reason);
  };
  es.addEventListener("open", () => onOpen());
  es.addEventListener("data", (e) => onData(JSON.parse(e.data)));
  es.addEventListener("closed", (e) => finish(JSON.parse(e.data) || "The Serial Monitor closed."));
  es.onerror = () => {
    // The server refuses busy ports before the stream starts.
    if (es.readyState === EventSource.CLOSED || es.readyState === EventSource.CONNECTING) {
      finish("ArduinoPath couldn't open the port. Is another program (like the Arduino IDE) using it?");
    }
  };
  return {
    write: (text) => api.serialWrite(port, text),
    close: () => {
      if (!closed) api.serialClose(port).catch(() => {});
      finish("");
    },
  };
}
