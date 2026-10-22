// Talks to ArduinoPath.exe, running on this laptop. Every write carries the
// X-ArduinoPath header, which it requires (it stops other websites sending
// requests as a logged-in student).

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || "Something went wrong. Try again.");
    this.status = status;
    this.code = body?.error || "unknown";
    this.retryAfter = body?.retry_after || 0;
  }

  /** True when ArduinoPath.exe couldn't be reached (it has closed). */
  get offline() {
    return this.status === 0;
  }
}

const listeners = new Set();

/** Called with no arguments when the server says the student is logged out. */
export function onLoggedOut(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function request(method, path, body, { raw = false, keepalive = false } = {}) {
  const headers = {};
  let payload;
  if (method !== "GET") headers["X-ArduinoPath"] = "1";
  if (body instanceof Blob || body instanceof ArrayBuffer) {
    headers["Content-Type"] = "application/octet-stream";
    payload = body;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, { method, headers, body: payload, credentials: "same-origin", keepalive });
  } catch {
    throw new ApiError(0, { error: "offline", message: "ArduinoPath has closed. Open ArduinoPath again from the Start menu or your desktop." });
  }
  if (raw && res.ok) return res;
  let data = null;
  if (res.status !== 204) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const err = new ApiError(res.status, data);
    if (err.code === "logged_out" && !path.startsWith("/api/login")) listeners.forEach((fn) => fn());
    throw err;
  }
  return data;
}

export const api = {
  info: () => request("GET", "/api/info"),
  catalogue: () => request("GET", "/api/catalogue"),
  project: (id) => request("GET", `/api/projects/${encodeURIComponent(id)}`),
  ping: () => request("GET", "/api/ping"),
  students: () => request("GET", "/api/students"),
  createStudent: (profile) => request("POST", "/api/students", profile),
  login: (studentId) => request("POST", "/api/login", { student_id: studentId }),
  wipe: () => request("POST", "/api/wipe", { confirm: "WIPE" }),
  everyoneExportUrl: "/api/everyone/export",
  tools: () => request("GET", "/api/tools"),
  prepareTools: (family) => request("POST", "/api/tools/prepare", { family }),
  compile: (code, board, variant) => request("POST", "/api/compile", { code, board, variant }),
  upload: (code, board, variant, port) => request("POST", "/api/upload", { code, board, variant, port }),
  job: (id) => request("GET", `/api/jobs/${encodeURIComponent(id)}`),
  ports: () => request("GET", "/api/ports"),
  serialWrite: (port, text) => request("POST", "/api/serial/write", { port, text }),
  serialClose: (port) => request("POST", "/api/serial/close", { port }),
  logout: () => request("POST", "/api/logout"),
  me: () => request("GET", "/api/me"),
  saveSettings: (settings) => request("PUT", "/api/me/settings", settings),
  progress: () => request("GET", "/api/me/progress"),
  saveProgress: (project, data) => request("PUT", `/api/me/progress/${encodeURIComponent(project)}`, data),
  sketch: (project) => request("GET", `/api/me/sketches/${encodeURIComponent(project)}`),
  saveSketch: (project, code, opts) => request("PUT", `/api/me/sketches/${encodeURIComponent(project)}`, { code }, opts),
  previewImport: (file) => request("POST", "/api/me/import?mode=preview", file),
  applyImport: (file, replace) => request("POST", `/api/me/import?mode=apply&replace=${replace ? "true" : "false"}`, file),
  exportUrl: "/api/me/export",
};
