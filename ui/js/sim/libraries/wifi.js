// WiFi (ESP32 WiFi.h, ESP8266 ESP8266WiFi.h; WiFi.h also works on ESP8266
// through ArduinoPath's shim) and the web servers (WebServer /
// ESP8266WebServer). WiFi.begin() "connects" to a pretend network after
// about a second; web pages are asked for by the phone panel (sim.http()).

import { sleep } from "../api.js";
import { toText, fromText } from "../values.js";

const WIFI_TYPES = `
typedef enum { WL_NO_SHIELD = 255, WL_IDLE_STATUS = 0, WL_NO_SSID_AVAIL = 1, WL_SCAN_COMPLETED = 2, WL_CONNECTED = 3, WL_CONNECT_FAILED = 4, WL_CONNECTION_LOST = 5, WL_DISCONNECTED = 6 } wl_status_t;
typedef enum { WIFI_OFF = 0, WIFI_STA = 1, WIFI_AP = 2, WIFI_AP_STA = 3 } WiFiMode_t;
typedef enum { WIFI_IF_STA = 0, WIFI_IF_AP = 1 } wifi_interface_t;
#ifdef ESP32
typedef enum { WIFI_AUTH_OPEN = 0, WIFI_AUTH_WEP, WIFI_AUTH_WPA_PSK, WIFI_AUTH_WPA2_PSK, WIFI_AUTH_WPA_WPA2_PSK, WIFI_AUTH_WPA2_ENTERPRISE, WIFI_AUTH_WPA3_PSK } wifi_auth_mode_t;
#else
#define ENC_TYPE_WEP 5
#define ENC_TYPE_TKIP 2
#define ENC_TYPE_CCMP 4
#define ENC_TYPE_NONE 7
#define ENC_TYPE_AUTO 8
#endif
class IPAddress {
public:
  IPAddress();
  IPAddress(uint8_t a, uint8_t b, uint8_t c, uint8_t d);
  String toString();
};
`;

const WIFI = (cls) => `
#include <_wifitypes.h>
class ${cls} {
public:
  wl_status_t begin(String ssid, String passphrase);
  wl_status_t begin(String ssid);
  wl_status_t begin();
  wl_status_t status();
  bool isConnected();
  bool disconnect(bool wifioff = false);
  bool reconnect();
  bool mode(WiFiMode_t m);
  WiFiMode_t getMode();
  bool config(IPAddress local_ip, IPAddress gateway, IPAddress subnet);
  bool config(IPAddress local_ip, IPAddress gateway, IPAddress subnet, IPAddress dns1);
  IPAddress localIP();
  IPAddress gatewayIP();
  IPAddress subnetMask();
  IPAddress dnsIP();
  String macAddress();
  String SSID();
  int32_t RSSI();
  int32_t channel();
  bool softAP(String ssid, String passphrase = "", int channel = 1, int ssid_hidden = 0, int max_connection = 4);
  bool softAPdisconnect(bool wifioff = false);
  IPAddress softAPIP();
  String softAPmacAddress();
  uint8_t softAPgetStationNum();
  int16_t scanNetworks(bool async = false, bool show_hidden = false);
  int16_t scanComplete();
  void scanDelete();
  String SSID(uint8_t i);
  int32_t RSSI(uint8_t i);
  int32_t channel(uint8_t i);
  uint8_t encryptionType(uint8_t i);
  String BSSIDstr(uint8_t i);
  bool setHostname(String name);
  bool hostname(String name);
  String getHostname();
  void setAutoReconnect(bool on);
  void persistent(bool on);
  void setSleep(bool on);
  bool setTxPower(int power);
};
extern ${cls} WiFi;
`;

const HTTP_TYPES = `
enum HTTPMethod { HTTP_ANY, HTTP_GET, HTTP_HEAD, HTTP_POST, HTTP_PUT, HTTP_PATCH, HTTP_DELETE, HTTP_OPTIONS };
`;

const SERVER = (cls, wifiHeader) => `
#include <${wifiHeader}>
#include <_http.h>
class ${cls} {
public:
  ${cls}(int port = 80);
  void begin();
  void begin(uint16_t port);
  void close();
  void stop();
  void on(String uri, callback handler);
  void on(String uri, HTTPMethod method, callback handler);
  void onNotFound(callback handler);
  void handleClient();
  String uri();
  HTTPMethod method();
  String arg(String name);
  String arg(int i);
  String argName(int i);
  int args();
  bool hasArg(String name);
  String header(String name);
  bool hasHeader(String name);
  String hostHeader();
  void send(int code, String content_type = "", String content = "");
  void send_P(int code, String content_type, String content);
  void sendHeader(String name, String value, bool first = false);
  void sendContent(String content);
  void setContentLength(size_t len);
  void enableCORS(bool on = true);
};
`;

const MDNS = `
class MDNSResponder {
public:
  bool begin(String hostName);
  void addService(String service, String proto, uint16_t port);
  void update();
  void end();
};
extern MDNSResponder MDNS;
`;

/** Pretend networks for WiFi.scanNetworks(). */
export const NETWORKS = [
  { ssid: "BNTS-Lab", rssi: -42, channel: 6, open: false },
  { ssid: "Library-WiFi", rssi: -58, channel: 1, open: false },
  { ssid: "ArduinoPath-Demo", rssi: -63, channel: 11, open: true },
  { ssid: "Staffroom", rssi: -71, channel: 6, open: false },
  { ssid: "Phone Hotspot", rssi: -79, channel: 3, open: false },
  { ssid: "Cafe Guest", rssi: -86, channel: 9, open: true },
];

export class IPAddress {
  constructor(R, a = 0, b = 0, c = 0, d = 0) {
    if (typeof R === "string") { this.ip = R; return; }
    this.ip = [a, b, c, d].map((x) => x & 255).join(".");
  }
  toString() { return this.ip; }
}

const ip = (s) => new IPAddress(s);

export class WiFiClass {
  constructor(R) {
    this.R = R;
    this.modeV = 1;
    this.ssid = "";
    this.statusV = 0;
    this.ip = "0.0.0.0";
    this.apIp = "0.0.0.0";
    this.scan = null;
    this.hostName = R.family === "esp32" ? "esp32-a1b2c3" : "ESP-A1B2C3";
    R.wifiObj = this;
  }
  setStatus(status, extra = {}) {
    const R = this.R;
    R.wifi.status = status;
    R.wifi.ip = status === "ap" ? this.apIp : this.ip;
    R.emit("wifi", { status, ip: R.wifi.ip, ssid: this.ssid, ...extra });
  }
  begin(ssid, pass = "") {
    const R = this.R;
    this.ssid = ssid ?? this.ssid;
    void pass;
    this.statusV = 6; // WL_DISCONNECTED while connecting
    if (this.timer) R.cancel(this.timer);
    this.setStatus("connecting");
    this.timer = R.at(R.us + 1_200_000, () => {
      this.timer = null;
      if (!this.ssid) { this.statusV = 1; this.setStatus("failed"); return; }
      this.statusV = 3;
      this.ip = "192.168.1.42";
      this.setStatus("connected");
      R.onWifiConnected?.();
    });
    return this.statusV;
  }
  status() { this.R.progress(); return this.statusV; }
  isConnected() { return this.statusV === 3 ? 1 : 0; }
  reconnect() { this.begin(this.ssid); return 1; }
  disconnect() {
    if (this.timer) { this.R.cancel(this.timer); this.timer = null; }
    if (this.statusV === 3) { this.statusV = 6; this.ip = "0.0.0.0"; this.setStatus("disconnected"); }
    return 1;
  }
  mode(m) { this.modeV = m; return 1; }
  getMode() { return this.modeV; }
  config() { return 1; }
  localIP() { return ip(this.ip); }
  gatewayIP() { return ip(this.statusV === 3 ? "192.168.1.1" : "0.0.0.0"); }
  subnetMask() { return ip(this.statusV === 3 ? "255.255.255.0" : "0.0.0.0"); }
  dnsIP() { return this.gatewayIP(); }
  macAddress() { return this.R.mac; }
  SSID(i) {
    if (i === undefined) return this.statusV === 3 ? this.ssid : "";
    return this.scan?.[i]?.ssid ?? "";
  }
  RSSI(i) {
    if (i === undefined) return this.statusV === 3 ? -55 : 0;
    return this.scan?.[i]?.rssi ?? 0;
  }
  channel(i) { return i === undefined ? 6 : this.scan?.[i]?.channel ?? 0; }
  encryptionType(i) {
    const n = this.scan?.[i];
    if (!n) return 0;
    if (this.R.family === "esp32") return n.open ? 0 : 3;
    return n.open ? 7 : 4;
  }
  BSSIDstr(i) { return `A4:5E:60:00:00:${String(10 + (i & 63)).padStart(2, "0")}`; }
  softAP(ssid) {
    this.apSsid = ssid;
    this.apIp = "192.168.4.1";
    this.modeV |= 2;
    this.ssid = ssid;
    this.setStatus("ap", { ssid });
    return 1;
  }
  softAPdisconnect() { this.apIp = "0.0.0.0"; this.setStatus("disconnected"); return 1; }
  softAPIP() { return ip(this.apIp); }
  softAPmacAddress() { return this.R.mac.replace(/..$/, (h) => ((parseInt(h, 16) + 1) & 255).toString(16).toUpperCase().padStart(2, "0")); }
  softAPgetStationNum() { return this.apIp === "0.0.0.0" ? 0 : 1; }
  *scanNetworks(async = 0) {
    if (!async) yield* sleep(this.R, 1_500_000);
    this.scan = NETWORKS.map((n, k) => ({ ...n, rssi: n.rssi - ((Math.floor(this.R.us / 1e6) * 7 + k * 3) % 5) }));
    return this.scan.length;
  }
  scanComplete() { return this.scan ? this.scan.length : -2; }
  scanDelete() { this.scan = null; }
  setHostname(n) { this.hostName = n; return 1; }
  hostname(n) { return this.setHostname(n); }
  getHostname() { return this.hostName; }
  setAutoReconnect() {}
  persistent() {}
  setSleep() {}
  setTxPower() { return 1; }
}

const METHODS = ["ANY", "GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

/** WebServer / ESP8266WebServer. */
export class WebServer {
  constructor(R, port = 80) {
    this.R = R;
    this.port = port;
    this.routes = [];
    this.notFound = null;
    this.running = false;
    this.queue = [];
    this.cur = null;
    R.servers.push(this);
  }
  begin() { this.running = true; }
  close() { this.running = false; }
  stop() { this.running = false; }
  on(uri, a, b) {
    const method = b === undefined ? 0 : a;
    const fn = b === undefined ? a : b;
    this.routes.push({ uri, method, fn });
    this.R.emit("http_route", { method: METHODS[method] ?? "ANY", path: toText(uri) });
  }
  onNotFound(fn) { this.notFound = fn; }
  *handleClient() {
    const R = this.R;
    R.us += 100;
    R.progress();
    if (!this.running || !this.queue.length) return;
    const item = this.queue.shift();
    const req = item.req;
    const m = Math.max(0, METHODS.indexOf(String(req.method || "GET").toUpperCase()));
    const path = String(req.path || "/").split("?")[0];
    this.cur = { item, method: m, path, args: requestArgs(req), headers: [] };
    const route = this.routes.find((r) => toText(r.uri) === path && (r.method === 0 || r.method === m));
    if (route) yield* route.fn.call();
    else if (this.notFound) yield* this.notFound.call();
    else this.respond(404, "text/plain", `Not found: ${path}`);
    if (!item.done) this.respond(0, "text/plain", "", "no-response");
    this.cur = null;
  }
  respond(status, type, body, error) {
    const c = this.cur;
    if (!c || c.item.done) return;
    c.item.done = true;
    if (c.item.timer) this.R.cancel(c.item.timer);
    const headers = Object.fromEntries(c.headers);
    const res = { status, type: toText(type || ""), body: toText(body ?? ""), headers };
    if (error) res.error = error;
    this.R.emit("http_response", { method: METHODS[c.method], path: c.path, status });
    c.item.resolve(res);
  }
  uri() { return fromText(this.cur?.path ?? ""); }
  method() { return this.cur?.method ?? 1; }
  arg(k) {
    const args = this.cur?.args ?? [];
    if (typeof k === "number") return args[k]?.[1] ?? "";
    if (k === "plain") return fromText(this.cur?.item.req.body ?? "");
    return args.find(([n]) => n === k)?.[1] ?? "";
  }
  argName(i) { return this.cur?.args[i]?.[0] ?? ""; }
  args() { return this.cur?.args.length ?? 0; }
  hasArg(k) { return (this.cur?.args ?? []).some(([n]) => n === k) ? 1 : 0; }
  header() { return ""; }
  hasHeader() { return 0; }
  hostHeader() { return "192.168.4.1"; }
  send(code, type = "", content = "") { this.R.us += 200 + content.length * 2; this.respond(code, type, content); }
  send_P(code, type, content) { this.send(code, type, content); }
  sendHeader(n, v) { this.cur?.headers.push([toText(n), toText(v)]); }
  sendContent(s) { void s; }
  setContentLength() {}
  enableCORS() {}
}

/** Query string (and form) arguments as [name, byteString] pairs. */
function requestArgs(req) {
  const out = [];
  const q = req.query || {};
  if (typeof q === "string") for (const [k, v] of new URLSearchParams(q)) out.push([fromText(k), fromText(v)]);
  else for (const [k, v] of Object.entries(q)) out.push([fromText(k), fromText(String(v))]);
  const qs = String(req.path || "").split("?")[1];
  if (qs) for (const [k, v] of new URLSearchParams(qs)) out.push([fromText(k), fromText(v)]);
  if (req.form) for (const [k, v] of Object.entries(req.form)) out.push([fromText(k), fromText(String(v))]);
  return out;
}

export class MDNSResponder {
  constructor(R) { this.R = R; }
  begin() { return 1; }
  addService() {}
  update() {}
  end() {}
}

const wifiClass = (R) => new WiFiClass(R);

const classes = { WiFiClass, ESP8266WiFiClass: WiFiClass, IPAddress, WebServer, ESP8266WebServer: WebServer, MDNSResponder };

export default [
  {
    headers: {
      "_wifitypes.h": WIFI_TYPES,
      "_http.h": HTTP_TYPES,
      "WiFi.h": `#ifdef ESP32\n${WIFI("WiFiClass")}\n#else\n#include <ESP8266WiFi.h>\n#endif`,
      "WiFiClient.h": "",
      "WebServer.h": `#ifdef ESP32\n${SERVER("WebServer", "WiFi.h")}\n#else\n#include <ESP8266WebServer.h>\ntypedef ESP8266WebServer WebServer;\n#endif`,
    },
    families: ["esp8266", "esp32"],
    classes,
    objects: { WiFi: wifiClass, MDNS: (R) => new MDNSResponder(R) },
  },
  {
    headers: { "ESP8266WiFi.h": WIFI("ESP8266WiFiClass"), "ESP8266WebServer.h": SERVER("ESP8266WebServer", "ESP8266WiFi.h"), "ESP8266mDNS.h": MDNS },
    families: ["esp8266"],
  },
  {
    headers: { "ESPmDNS.h": MDNS, "WiFiAP.h": "" },
    families: ["esp32"],
  },
];

