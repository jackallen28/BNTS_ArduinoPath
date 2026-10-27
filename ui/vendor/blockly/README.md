# Blockly 12.5.1 (vendored)

Google's Blockly, from the `blockly@12.5.1` npm package, used offline for
ArduinoPath's Blocks view (`ui/js/blocks/`). Licensed under the Apache
License 2.0 (`LICENSE`). Copyright Google LLC.

- `blockly.min.js`: the package's browser build (core, the standard blocks)
- `en.js`: the package's `msg/en.js` (English messages)
- `media/`: the package's `media/` folder (icons and cursors)
- `blockly.css`: Blockly's own CSS, saved as a file (see the comment at its
  top) because ArduinoPath's Content-Security-Policy allows no inline styles

ArduinoPath's own blocks and their C++ are in `ui/js/blocks/`, not here.
