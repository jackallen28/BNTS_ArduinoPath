// The Web Worker the simulator runs in (started by simulation.js), so the
// student's code can never freeze the page.

import { SimHost } from "./host.js";

const host = new SimHost((msg) => self.postMessage(msg));
self.onmessage = (e) => host.handle(e.data);
