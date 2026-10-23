// Playwright drives the real web app against the real local program (dev
// mode, a fresh data folder, its own port). Run: npm run e2e
import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT) || 8543; // E2E_PORT lets two test runs share a computer

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: `node tests/e2e/fresh-data.js && go run ./cmd/arduinopath -dev -data test-results/e2e-data -port ${PORT}`,
    url: `http://localhost:${PORT}/api/info`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
