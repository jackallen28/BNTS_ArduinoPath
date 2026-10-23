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
 * Is this a USB port (a board), not one built into the computer (a Pi's
 * /dev/ttyAMA0, a PC's COM1, a Mac's Bluetooth port)? Built-in ports have
 * no USB ids.
 */
export function isUsb(p) {
  return Boolean(p?.vid);
}

/** USB ports first, then the computer's built-in ones. */
export function sortPorts(ports) {
  return [...ports].sort((a, b) => Number(isUsb(b)) - Number(isUsb(a)));
}

/**
 * The best guess at the student's board: the remembered port if it's still
 * there, else a port whose board matches, else the only USB port, else null.
 */
export function guessPort(ports, board, remembered) {
  if (remembered && ports.some((p) => p.port === remembered)) return remembered;
  const match = ports.find((p) => p.fqbn && board && p.fqbn.startsWith(board.fqbn.split(":").slice(0, 3).join(":")));
  if (match) return match.port;
  const usb = ports.filter(isUsb);
  return usb.length === 1 ? usb[0].port : null;
}

const PORT_KEY = "arduinopath.port";

/** The port the student used last (shared by the workspace and the Wiring Wizard). */
export function rememberedPort() {
  try {
    return localStorage.getItem(PORT_KEY);
  } catch {
    return null;
  }
}

export function rememberPort(port) {
  try {
    localStorage.setItem(PORT_KEY, port);
  } catch { /* private window */ }
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
  if (!isUsb(p)) return `${p.port} (built into this computer: not your board)`;
  return what ? `${p.port} (${what})` : p.port;
}

/**
 * The Serial Monitor for a real board. onData(text), onClose(reason).
 * Returns { write(text), close() }.
 *
 * Right after an upload the port can be missing or busy for a moment while
 * the board restarts (boards with USB built in, like the ESP32-C3, even
 * disappear and come back), so it tries again for a few seconds
 * (retryMs) before giving up.
 */
export function openSerial(port, baud, { onData, onOpen = () => {}, onClose = () => {}, retryMs = 0 } = {}) {
  const giveUpAt = Date.now() + retryMs;
  let es = null;
  let closed = false;
  let opened = false;
  let timer = 0;
  const finish = (reason) => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    if (es) es.close();
    onClose(reason);
  };
  function connect() {
    es = new EventSource(`/api/serial?port=${encodeURIComponent(port)}&baud=${baud}`);
    es.addEventListener("open", () => {
      opened = true;
      onOpen();
    });
    es.addEventListener("data", (e) => onData(JSON.parse(e.data)));
    es.addEventListener("closed", (e) => finish(JSON.parse(e.data) || "The Serial Monitor closed."));
    es.onerror = () => {
      // The server refuses busy or missing ports before the stream starts.
      if (es.readyState !== EventSource.CLOSED && es.readyState !== EventSource.CONNECTING) return;
      es.close();
      if (!opened && !closed && Date.now() < giveUpAt) {
        timer = setTimeout(connect, 700);
        return;
      }
      finish(opened
        ? "Your board was unplugged, or the connection stopped. Plug it back in, then press Upload again."
        : "ArduinoPath couldn't open the port. Is another program (like the Arduino IDE) using it?");
    };
  }
  connect();
  return {
    write: (text) => api.serialWrite(port, text),
    close: () => {
      if (!closed) api.serialClose(port).catch(() => {});
      finish("");
    },
  };
}
