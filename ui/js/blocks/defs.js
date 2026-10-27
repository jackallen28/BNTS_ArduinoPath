// The blocks: their shapes, words and colours, and the toolbox. The C++
// each one makes is in cpp.js (toCode), which is what Run and Upload use.

/** Colours by toolbox category. */
export const COLOURS = {
  start: "#0f9aa1",     // BNTS teal
  pins: "#3b73c4",
  servo: "#e07b00",
  sensors: "#2e9b45",
  sound: "#c2417a",
  serial: "#5a6878",
  logic: "#704988",     // BNTS purple
  maths: "#5b67a5",
  variables: "#c2632f",
  functions: "#8a5a2b",
  words: "#4a8fa8",
  code: "#8d929a",
};

export const SERIAL_SPEEDS = ["9600", "115200", "57600", "38400", "19200", "4800", "2400", "1200", "74880", "250000"];

const B = (type, message0, args0, { colour, output = false, statement = true, inline = true, tooltip = "" } = {}) => ({
  type,
  message0,
  args0,
  colour,
  inputsInline: inline,
  tooltip,
  ...(output ? { output: null } : statement ? { previousStatement: null, nextStatement: null } : {}),
});
const value = (name) => ({ type: "input_value", name });
const text = (name, t) => ({ type: "field_input", name, text: t });
const drop = (name, options) => ({ type: "field_dropdown", name, options });
const stmts = (name) => ({ type: "input_statement", name });
const dummy = { type: "input_dummy" };

export const BLOCKS = [
  // Start
  { type: "ap_setup", message0: "when the board starts %1 %2", args0: [dummy, stmts("DO")], colour: COLOURS.start, tooltip: "setup(): runs once, when the board starts." },
  { type: "ap_loop", message0: "forever %1 %2", args0: [dummy, stmts("DO")], colour: COLOURS.start, tooltip: "loop(): runs again and again, forever." },
  B("ap_delay", "wait %1 milliseconds", [value("MS")], { colour: COLOURS.start, tooltip: "delay(): 1000 milliseconds is 1 second." }),
  B("ap_delay_us", "wait %1 microseconds", [value("US")], { colour: COLOURS.start, tooltip: "delayMicroseconds(): a millionth of a second each." }),
  // Pins
  B("ap_pin_mode", "set pin %1 to %2", [value("PIN"), drop("MODE", [["output", "OUTPUT"], ["input", "INPUT"], ["input with pull-up", "INPUT_PULLUP"]])], { colour: COLOURS.pins, tooltip: "pinMode(): get a pin ready to send power out, or to read." }),
  B("ap_digital_write", "turn pin %1 %2", [value("PIN"), value("VALUE")], { colour: COLOURS.pins, tooltip: "digitalWrite(): HIGH is on, LOW is off." }),
  B("ap_analog_write", "set pin %1 brightness %2", [value("PIN"), value("VALUE")], { colour: COLOURS.pins, tooltip: "analogWrite(): from 0 (off) up to full." }),
  B("ap_digital_read", "read pin %1", [value("PIN")], { colour: COLOURS.pins, output: true, tooltip: "digitalRead(): HIGH or LOW." }),
  B("ap_analog_read", "read analog pin %1", [value("PIN")], { colour: COLOURS.pins, output: true, tooltip: "analogRead(): a number from 0 up to ANALOG_MAX." }),
  // Servo
  B("ap_servo_attach", "connect servo %1 to pin %2", [text("VAR", "myServo"), value("PIN")], { colour: COLOURS.servo, tooltip: "attach(): which pin the servo's signal wire is on." }),
  B("ap_servo_write", "turn servo %1 to %2 °", [text("VAR", "myServo"), value("ANGLE")], { colour: COLOURS.servo, tooltip: "write(): turn to an angle from 0° to 180°." }),
  // Sensors
  B("ap_distance", "distance in cm", [], { colour: COLOURS.sensors, output: true, tooltip: "measureCm(): how far away something is, from the ultrasonic sensor." }),
  B("ap_millis", "milliseconds since the start", [], { colour: COLOURS.sensors, output: true, tooltip: "millis(): how long the board has been running." }),
  // Sound
  B("ap_tone", "play a note on pin %1 at %2 Hz", [value("PIN"), value("FREQ")], { colour: COLOURS.sound, tooltip: "tone(): a higher number is a higher note." }),
  B("ap_tone_for", "play a note on pin %1 at %2 Hz for %3 ms", [value("PIN"), value("FREQ"), value("MS")], { colour: COLOURS.sound }),
  B("ap_no_tone", "stop the note on pin %1", [value("PIN")], { colour: COLOURS.sound, tooltip: "noTone()" }),
  // Serial Monitor
  B("ap_serial_begin", "start the Serial Monitor at %1", [drop("BAUD", SERIAL_SPEEDS.map((s) => [s, s]))], { colour: COLOURS.serial, tooltip: "Serial.begin(): 9600 is the usual speed." }),
  B("ap_serial_print", "Serial Monitor: %1 %2", [drop("NL", [["print a line", "println"], ["print", "print"]]), value("VALUE")], { colour: COLOURS.serial, tooltip: "Serial.println() starts a new line after; Serial.print() doesn't." }),
  // Logic
  B("ap_compare", "%1 %2 %3", [value("A"), drop("OP", [["<", "<"], [">", ">"], ["≤", "<="], ["≥", ">="], ["=", "=="], ["≠", "!="]]), value("B")], { colour: COLOURS.logic, output: true, tooltip: "Compare two numbers: true or false." }),
  B("ap_logic", "%1 %2 %3", [value("A"), drop("OP", [["and", "&&"], ["or", "||"]]), value("B")], { colour: COLOURS.logic, output: true }),
  B("ap_not", "not %1", [value("A")], { colour: COLOURS.logic, output: true }),
  { type: "ap_while", message0: "while %1 %2 %3", args0: [value("COND"), dummy, stmts("DO")], previousStatement: null, nextStatement: null, colour: COLOURS.logic, tooltip: "Keep doing this while it's true." },
  // Maths
  B("ap_arith", "%1 %2 %3", [value("A"), drop("OP", [["+", "+"], ["−", "-"], ["×", "*"], ["÷", "/"], ["remainder", "%"]]), value("B")], { colour: COLOURS.maths, output: true }),
  B("ap_random", "random number from %1 to below %2", [value("MIN"), value("MAX")], { colour: COLOURS.maths, output: true, tooltip: "random(): the top number is never picked." }),
  B("ap_map", "change %1 from %2 – %3 to %4 – %5", [value("VALUE"), value("FROM_LOW"), value("FROM_HIGH"), value("TO_LOW"), value("TO_HIGH")], { colour: COLOURS.maths, output: true, tooltip: "map(): turn a number in one range into the same spot in another." }),
  { type: "ap_for", message0: "count with %1 from %2 to below %3 %4 %5", args0: [text("VAR", "i"), value("FROM"), value("TO"), dummy, stmts("DO")], inputsInline: true, previousStatement: null, nextStatement: null, colour: COLOURS.maths, tooltip: "A for loop." },
  // Variables
  B("ap_var_declare", "make %1 %2 = %3", [text("TYPE", "int"), text("NAME", "number"), value("VALUE")], { colour: COLOURS.variables, tooltip: "Make a variable: a named box that holds a value. long holds big whole numbers." }),
  B("ap_var_set", "set %1 %2 %3", [text("NAME", "number"), drop("OP", [["to", "="], ["up by", "+="], ["down by", "-="]]), value("VALUE")], { colour: COLOURS.variables }),
  B("ap_var_change", "%1 %2", [text("NAME", "number"), drop("OP", [["++ (add 1)", "++"], ["-- (take 1)", "--"]])], { colour: COLOURS.variables }),
  // Functions
  { type: "ap_function", message0: "%1 %2 %3 %4", args0: [text("TYPE", "void"), text("NAME", "myFunction"), dummy, stmts("DO")], colour: COLOURS.functions, tooltip: "A function: a group of blocks with a name." },
  B("ap_call", "do %1", [text("NAME", "myFunction")], { colour: COLOURS.functions }),
  B("ap_call_value", "result of %1", [text("NAME", "myFunction")], { colour: COLOURS.functions, output: true }),
  B("ap_return", "give back %1", [value("VALUE")], { colour: COLOURS.functions, tooltip: "return: the answer the function gives." }),
  B("ap_return_void", "stop the function here", [], { colour: COLOURS.functions }),
  // Words: a pin name, HIGH, LOW, a variable...
  B("ap_word", "%1", [text("NAME", "HIGH")], { colour: COLOURS.words, output: true, tooltip: "A name: a pin (like LED_PIN), HIGH or LOW, or one of your variables." }),
];

/** Defines the blocks in Blockly (the JSON ones, and the JS ones that need code). */
export function defineBlocks(Blockly) {
  Blockly.defineBlocksWithJsonArray(BLOCKS);
  for (const type of ["ap_setup", "ap_loop", "ap_function"]) {
    const init = Blockly.Blocks[type].init;
    Blockly.Blocks[type].init = function () {
      init.call(this);
      this.hat = "cap";
    };
  }
  // C++ code the blocks don't cover yet, kept as it was. Edit it in Text.
  const rawBlock = (statement, output) => ({
    init() {
      this.setColour(COLOURS.code);
      if (statement) { this.setPreviousStatement(true); this.setNextStatement(true); }
      if (output) this.setOutput(true);
      this.setTooltip("C++ code that has no block yet. Switch to Text to change it.");
      this.code = "";
      this.lines();
    },
    lines() {
      for (const name of this.inputList.map((i) => i.name)) this.removeInput(name);
      const all = String(this.code || "").split("\n");
      const shown = all.length > 12 ? [...all.slice(0, 11), "…"] : all;
      shown.forEach((line, i) => this.appendDummyInput(`L${i}`).appendField(new Blockly.FieldLabel(line.length > 70 ? `${line.slice(0, 69)}…` : line || " ", "ap-raw-line")));
    },
    saveExtraState() { return { code: this.code }; },
    loadExtraState(state) { this.code = state?.code ?? ""; this.lines(); },
  });
  Blockly.Blocks.ap_raw = rawBlock(true, false);
  Blockly.Blocks.ap_raw_top = rawBlock(true, false);
  Blockly.Blocks.ap_raw_value = rawBlock(false, true);
}

const num = (n) => ({ shadow: { type: "math_number", fields: { NUM: n } } });
const word = (w) => ({ block: { type: "ap_word", fields: { NAME: w } } });
const txt = (t) => ({ shadow: { type: "text", fields: { TEXT: t } } });

/**
 * The toolbox, with this project's pin names and the code's variables and
 * servos ready to drag in.
 */
export function toolbox({ pins = [], variables = [], servos = [] } = {}) {
  // Outputs default to a light (LED_PIN, LED_RED...) when the project has one.
  const pin = pins.find((p) => /^LED/.test(p)) || pins[0] || "LED_PIN";
  const servo = servos[0] || "myServo";
  const cat = (name, colour, contents) => ({ kind: "category", name, colour, contents });
  const block = (type, extra = {}) => ({ kind: "block", type, ...extra });
  const wordBlock = (w) => block("ap_word", { fields: { NAME: w } });
  return {
    kind: "categoryToolbox",
    contents: [
      cat("Start", COLOURS.start, [
        block("ap_setup"), block("ap_loop"),
        block("ap_delay", { inputs: { MS: num(1000) } }),
      ]),
      cat("Pins", COLOURS.pins, [
        block("ap_pin_mode", { inputs: { PIN: word(pin) } }),
        block("ap_digital_write", { inputs: { PIN: word(pin), VALUE: word("HIGH") } }),
        block("ap_digital_write", { inputs: { PIN: word(pin), VALUE: word("LOW") } }),
        block("ap_digital_read", { inputs: { PIN: word(pin) } }),
        block("ap_analog_read", { inputs: { PIN: word(pin) } }),
        block("ap_analog_write", { inputs: { PIN: word(pin), VALUE: num(128) } }),
        ...pins.map(wordBlock), wordBlock("HIGH"), wordBlock("LOW"),
      ]),
      cat("Servo", COLOURS.servo, [
        block("ap_servo_attach", { fields: { VAR: servo }, inputs: { PIN: word(pins.find((p) => /SERVO/.test(p)) || "SERVO_PIN") } }),
        block("ap_servo_write", { fields: { VAR: servo }, inputs: { ANGLE: num(90) } }),
      ]),
      cat("Sensors", COLOURS.sensors, [block("ap_distance"), block("ap_millis")]),
      cat("Sound", COLOURS.sound, [
        block("ap_tone_for", { inputs: { PIN: word(pins.find((p) => /BUZZER/.test(p)) || "BUZZER_PIN"), FREQ: num(440), MS: num(200) } }),
        block("ap_no_tone", { inputs: { PIN: word(pins.find((p) => /BUZZER/.test(p)) || "BUZZER_PIN") } }),
      ]),
      cat("Serial Monitor", COLOURS.serial, [
        block("ap_serial_begin", { fields: { BAUD: "9600" } }),
        block("ap_serial_print", { fields: { NL: "println" }, inputs: { VALUE: txt("Hello!") } }),
        block("ap_serial_print", { fields: { NL: "print" }, inputs: { VALUE: txt(" cm") } }),
      ]),
      cat("Logic", COLOURS.logic, [
        block("controls_if"),
        block("controls_if", { extraState: { hasElse: true } }),
        block("ap_compare", { fields: { OP: "<" }, inputs: { A: num(0), B: num(30) } }),
        block("ap_logic", { fields: { OP: "&&" } }),
        block("ap_not"),
        block("ap_while"),
      ]),
      cat("Maths", COLOURS.maths, [
        block("math_number", { fields: { NUM: 0 } }),
        block("text", { fields: { TEXT: "" } }),
        block("ap_arith", { fields: { OP: "+" }, inputs: { A: num(1), B: num(1) } }),
        block("ap_random", { inputs: { MIN: num(1), MAX: num(7) } }),
        block("ap_map", { inputs: { FROM_LOW: num(0), FROM_HIGH: num(1023), TO_LOW: num(0), TO_HIGH: num(180) } }),
        block("ap_for", { inputs: { FROM: num(0), TO: num(10) } }),
      ]),
      cat("Variables", COLOURS.variables, [
        block("ap_var_declare", { fields: { TYPE: "long", NAME: variables[0] || "number" }, inputs: { VALUE: num(0) } }),
        block("ap_var_set", { fields: { NAME: variables[0] || "number", OP: "=" }, inputs: { VALUE: num(0) } }),
        block("ap_var_change", { fields: { NAME: variables[0] || "number", OP: "++" } }),
        ...variables.map(wordBlock),
      ]),
      cat("Functions", COLOURS.functions, [
        block("ap_function"), block("ap_call"), block("ap_call_value"), block("ap_return"),
      ]),
    ],
  };
}
