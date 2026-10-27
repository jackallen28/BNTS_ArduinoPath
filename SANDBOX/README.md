# Sandbox

Keep experimental projects, prototypes, wiring diagrams and visual previews in this folder. Give each experiment a named subfolder and a README explaining its purpose, how to run or reproduce it, and its validation status.

## Current experiments

- [Uno bin controller, C3 relay and supplied-model animation](bin-monitor/README.md) — runnable prototype, browser-captured previews and hardware documentation.

## Working conventions

- Work on a branch for the experiment. Keep application source, curriculum and shared assets outside SANDBOX unchanged unless the task explicitly includes them.
- Reuse ArduinoPath’s vanilla JavaScript components, BNTS Vista theme and official school branding where applicable.
- Keep each experiment’s sources, local helper files and outputs together in its subfolder. Document tool versions, dependencies, run commands and meaningful validation steps when runnable code is added.
- Clearly label simulated data and generated illustrations. Record which screenshots are actual browser captures.
- Keep software checks separate from physical-board testing. List outstanding compile/upload, power, voltage, Wi-Fi and sensor checks explicitly.
- Keep credentials, personal student information, caches and dependency directories out of commits.
- Review an experiment separately before integrating it into the main application.
