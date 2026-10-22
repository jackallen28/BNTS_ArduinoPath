// Fills in the Wiring Wizard's text for the student's board. A project's
// wiring_steps text says "{{pin:LED_RED}}" rather than "pin 12", because
// the pin depends on the board:
//
//   {{pin:ROLE}}  → "pin 12" / "pin D5" / "pin A0" (the label printed on the board)
//   {{VCC}}       → "5V" or "3V3" (the board's logic voltage)
//   {{5V}}        → "5V", or "VIN" on boards without a 5V pin (NodeMCU, ESP32 DevKit)
//   {{3V3}}       → "3V3"
//   {{board}}     → the board's short name ("Uno")

import { defaultResolvePin, powerName } from "./netlist.js";

/**
 * @param {string} text  a wiring step's text
 * @param {object} board  content/boards/<id>.json
 * @param {((name: string) => ({code: string}|null)) | Record<string,string>} [pins]  resolvePin, or role → code overrides
 * @returns {string}
 */
export function fillWiringText(text, board, pins) {
  const resolve = typeof pins === "function" ? pins : defaultResolvePin(board, pins || {});
  return String(text || "").replace(/\{\{([^}]+)\}\}/g, (whole, key) => {
    if (key.startsWith("pin:")) {
      const r = resolve(key.slice(4));
      if (!r) return whole.slice(6, -2);
      const label = (board.pins || []).find((p) => p.code === r.code)?.label || r.code;
      return `pin ${label}`;
    }
    if (key === "VCC" || key === "5V" || key === "3V3") return powerName(board, key) || key;
    if (key === "board") return board.short || board.name || board.id;
    return whole;
  });
}
