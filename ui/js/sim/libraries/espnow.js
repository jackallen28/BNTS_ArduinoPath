// ESP-NOW (the ESP32 core 3.x API): esp_now_send() emits
// espnow {to, data, text}; messages from another board arrive with
// R.espNowReceive(fromMac, bytes) (sim.espNowReceive / sim_events { espnow }).

import { Ptr, toText } from "../values.js";

const HEADER = `
#include <WiFi.h>
typedef int esp_err_t;
#define ESP_OK 0
#define ESP_FAIL -1
#define ESP_ERR_ESPNOW_NOT_INIT 0x3069
#define ESP_ERR_ESPNOW_ARG 0x306a
#define ESP_ERR_ESPNOW_NOT_FOUND 0x306f
#define ESP_ERR_ESPNOW_EXIST 0x306e
#define ESP_NOW_ETH_ALEN 6
#define ESP_NOW_KEY_LEN 16
#define ESP_NOW_MAX_DATA_LEN 250
typedef struct {
  uint8_t peer_addr[6];
  uint8_t lmk[16];
  uint8_t channel;
  wifi_interface_t ifidx;
  bool encrypt;
  void* priv;
} esp_now_peer_info_t;
typedef struct {
  uint8_t* src_addr;
  uint8_t* des_addr;
  void* rx_ctrl;
} esp_now_recv_info_t;
typedef enum { ESP_NOW_SEND_SUCCESS = 0, ESP_NOW_SEND_FAIL } esp_now_send_status_t;
esp_err_t esp_now_init();
esp_err_t esp_now_deinit();
esp_err_t esp_now_add_peer(const esp_now_peer_info_t* peer);
esp_err_t esp_now_del_peer(const uint8_t* peer_addr);
bool esp_now_is_peer_exist(const uint8_t* peer_addr);
esp_err_t esp_now_send(const uint8_t* peer_addr, const uint8_t* data, size_t len);
esp_err_t esp_now_register_recv_cb(callback cb);
esp_err_t esp_now_register_send_cb(callback cb);
esp_err_t esp_now_unregister_recv_cb();
esp_err_t esp_now_unregister_send_cb();
`;

const macText = (bytes) => Array.from(bytes, (b) => (b & 255).toString(16).toUpperCase().padStart(2, "0")).join(":");
const macBytes = (text) => Uint8Array.from(String(text).split(":").map((h) => parseInt(h, 16) & 255));
const bytesOf = (p, n) => Array.from({ length: n }, (_, k) => p.a[p.i + k] & 255);

function state(R) {
  return (R.espnow ||= { on: false, peers: new Set(), recv: null, sent: null });
}

export const functions = {
  esp_now_init(R) {
    const s = state(R);
    s.on = true;
    R.espNowReceive = (from, data) => deliver(R, from, data);
    return 0;
  },
  esp_now_deinit(R) { state(R).on = false; return 0; },
  esp_now_add_peer(R, p) {
    const s = state(R);
    if (!s.on) return 0x3069;
    const peer = p.a[p.i];
    const mac = macText(peer.peer_addr);
    if (s.peers.has(mac)) return 0x306e;
    s.peers.add(mac);
    return 0;
  },
  esp_now_del_peer(R, p) { return state(R).peers.delete(macText(bytesOf(p, 6))) ? 0 : 0x306f; },
  esp_now_is_peer_exist(R, p) { return state(R).peers.has(macText(bytesOf(p, 6))) ? 1 : 0; },
  esp_now_send(R, to, data, len) {
    const s = state(R);
    if (!s.on) return 0x3069;
    if (len > 250) return 0x306a;
    const mac = to ? macText(bytesOf(to, 6)) : "FF:FF:FF:FF:FF:FF";
    if (to && !s.peers.has(mac)) return 0x306f;
    const bytes = bytesOf(data, len);
    R.us += 300;
    const text = toText(String.fromCharCode(...bytes)).replace(/\0+$/, "");
    R.emit("espnow", { from: R.mac, to: mac, data: bytes, text });
    if (s.sent) {
      const cb = s.sent;
      R.at(R.us + 2000, () => R.interrupt({ call: () => cb.call(new Ptr(macBytes(mac), 0), 0) }));
    }
    return 0;
  },
  esp_now_register_recv_cb(R, fn) { state(R).recv = fn; return 0; },
  esp_now_register_send_cb(R, fn) { state(R).sent = fn; return 0; },
  esp_now_unregister_recv_cb(R) { state(R).recv = null; return 0; },
  esp_now_unregister_send_cb(R) { state(R).sent = null; return 0; },
};

/** A message from another board arrives: runs the receive function. */
function deliver(R, from, data) {
  const s = state(R);
  if (!s.on || !s.recv) return false;
  const bytes = typeof data === "string" ? Array.from(new TextEncoder().encode(data)) : Array.from(data, (b) => b & 255);
  const info = { src_addr: new Ptr(macBytes(from || "24:6F:28:00:00:01"), 0), des_addr: new Ptr(macBytes(R.mac), 0), rx_ctrl: null };
  const buf = Uint8Array.from(bytes);
  R.interrupt({ call: () => s.recv.call(new Ptr([info], 0), new Ptr(buf, 0), buf.length) });
  return true;
}

export default {
  headers: { "esp_now.h": HEADER },
  families: ["esp32"],
  functions,
};
