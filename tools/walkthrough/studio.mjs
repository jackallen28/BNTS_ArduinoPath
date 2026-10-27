// A tiny video studio for ArduinoPath walkthroughs (development only).
// Drives the real app in Chromium at a human pace, with a visible mouse
// pointer and captions, records it with the DevTools screencast, and turns
// the frames into an MP4 with ffmpeg.
//
//   const s = await openStudio({ url: "http://localhost:8611/", out: "walkthrough.mp4" });
//   await s.title("Smart Bin", "A beginner's first project");
//   await s.caption("Pick your name, or press I'm new here.");
//   await s.click(s.page.getByRole("button", { name: "Next" }));
//   await s.finish();

import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The pointer, the click ripple, the caption and the title card, drawn over the app.
function overlay() {
  const css = `
    #wt-cursor { position: fixed; left: 0; top: 0; width: 26px; height: 34px; z-index: 2147483647; pointer-events: none;
      transform: translate(-100px, -100px); filter: drop-shadow(1px 2px 2px rgba(0,0,0,.45)); }
    #wt-ripple { position: fixed; z-index: 2147483646; pointer-events: none; width: 40px; height: 40px; margin: -20px 0 0 -20px;
      border-radius: 50%; border: 3px solid #19c1ca; opacity: 0; }
    #wt-ripple.go { animation: wt-ripple .5s ease-out; }
    @keyframes wt-ripple { from { transform: scale(.3); opacity: 1; } to { transform: scale(1.4); opacity: 0; } }
    #wt-caption { position: fixed; left: 50%; bottom: 34px; transform: translateX(-50%); z-index: 2147483645; pointer-events: none;
      max-width: 1100px; padding: 14px 26px 15px; border-radius: 12px; font: 600 22px/1.35 "Segoe UI", "Noto Sans", Arial, sans-serif;
      color: #1b1b1b; background: linear-gradient(180deg, #fffffb, #fff6cf); border: 1px solid #b9a66a;
      box-shadow: 0 8px 26px rgba(0,0,0,.35), inset 0 1px 0 #fff; text-align: center; opacity: 0; transition: opacity .35s; }
    #wt-caption.on { opacity: 1; }
    #wt-caption.top { bottom: auto; top: 70px; }
    #wt-caption b { color: #704988; }
    #wt-chapter { position: fixed; right: 18px; top: 74px; z-index: 2147483645; pointer-events: none; padding: 6px 14px;
      border-radius: 16px; font: 600 15px "Segoe UI", "Noto Sans", Arial, sans-serif; color: #fff;
      background: linear-gradient(180deg, #19c1ca, #0b9aa1); box-shadow: 0 3px 10px rgba(0,0,0,.3); opacity: 0; transition: opacity .35s; }
    #wt-chapter.on { opacity: .95; }
    #wt-title { position: fixed; inset: 0; z-index: 2147483644; display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 18px; color: #fff; text-align: center; opacity: 0; transition: opacity .6s; pointer-events: none;
      background: radial-gradient(ellipse at 30% 20%, #19c1ca 0%, #0b6f86 45%, #3d2a5c 100%); font-family: "Segoe UI", "Noto Sans", Arial, sans-serif; }
    #wt-title.on { opacity: 1; }
    #wt-title h1 { margin: 0; font-size: 64px; font-weight: 700; text-shadow: 0 4px 18px rgba(0,0,0,.35); }
    #wt-title p { margin: 0; font-size: 28px; max-width: 1100px; line-height: 1.4; }
    #wt-title small { margin-top: 26px; font-size: 18px; opacity: .85; }`;
  const add = () => {
    if (document.getElementById("wt-cursor")) return;
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    const cursor = document.createElement("div");
    cursor.id = "wt-cursor";
    cursor.innerHTML = '<svg viewBox="0 0 26 34" width="26" height="34"><path d="M2 2 L2 28 L8.5 22 L13 32 L17.5 30 L13 20.5 L22 20.5 Z" fill="#fff" stroke="#111" stroke-width="2" stroke-linejoin="round"/></svg>';
    const ripple = document.createElement("div");
    ripple.id = "wt-ripple";
    const caption = document.createElement("div");
    caption.id = "wt-caption";
    const chapter = document.createElement("div");
    chapter.id = "wt-chapter";
    const title = document.createElement("div");
    title.id = "wt-title";
    document.body.append(title, caption, chapter, ripple, cursor);
    addEventListener("mousemove", (e) => { cursor.style.transform = `translate(${e.clientX - 2}px, ${e.clientY - 2}px)`; }, true);
    addEventListener("mousedown", (e) => {
      ripple.style.left = `${e.clientX}px`;
      ripple.style.top = `${e.clientY}px`;
      ripple.classList.remove("go");
      void ripple.offsetWidth;
      ripple.classList.add("go");
    }, true);
  };
  if (document.body) add();
  else addEventListener("DOMContentLoaded", add);
}

/**
 * @param {object} o
 * @param {boolean} [o.annotate] false: a clean recording with no captions, chapter
 *   labels or title cards (the pauses stay, a little shorter)
 */
export async function openStudio({ url, out, width = 1600, height = 900, scale = 1.2, chromiumPath, annotate = true } = {}) {
  const browser = await chromium.launch(chromiumPath ? { executablePath: chromiumPath } : {});
  // bypassCSP: only so the studio's own overlay styles apply; the app's code is unchanged.
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, bypassCSP: true });
  const page = await context.newPage();
  await page.addInitScript(overlay);
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "walkthrough-"));
  const frames = [];
  const cdp = await context.newCDPSession(page);
  cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
    const file = path.join(dir, `f${String(frames.length).padStart(6, "0")}.jpg`);
    fs.writeFileSync(file, Buffer.from(data, "base64"));
    frames.push({ file, t: metadata.timestamp });
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await page.goto(url);
  await page.waitForLoadState("networkidle").catch(() => {});
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 88, maxWidth: Math.round(width * scale), maxHeight: Math.round(height * scale), everyNthFrame: 1 });

  let mouse = { x: width / 2, y: height / 2 };
  let shots = 0; // WT_SHOTS=folder saves a screenshot at each caption (to check a take)

  const s = {
    page,
    problems,
    sleep,
    /** Moves the pointer smoothly to (x, y). */
    async moveTo(x, y, ms = 650) {
      const from = { ...mouse };
      const n = Math.max(8, Math.round(ms / 16));
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
        await sleep(ms / n);
      }
      mouse = { x, y };
    },
    async pointAt(locator, { dx = 0.5, dy = 0.5, ms } = {}) {
      await locator.scrollIntoViewIfNeeded().catch(() => {});
      const box = await locator.boundingBox();
      if (!box) throw new Error(`Can't see ${locator}`);
      await s.moveTo(box.x + box.width * dx, box.y + box.height * dy, ms);
    },
    /** Moves to the element and clicks it, like a person. */
    async click(locator, { pause = 450, dx, dy } = {}) {
      await locator.waitFor({ state: "visible" });
      await s.pointAt(locator, { dx, dy });
      await sleep(180);
      await page.mouse.down();
      await sleep(90);
      await page.mouse.up();
      await sleep(pause);
    },
    async clickAt(x, y, { pause = 450 } = {}) {
      await s.moveTo(x, y);
      await sleep(150);
      await page.mouse.down();
      await sleep(90);
      await page.mouse.up();
      await sleep(pause);
    },
    /** Types at a typing pace. */
    async type(text, { delay = 85, pause = 400 } = {}) {
      await page.keyboard.type(text, { delay });
      await sleep(pause);
    },
    /** Drags with the pointer from one point to another. */
    async drag(from, to, { ms = 900, pause = 500 } = {}) {
      await s.moveTo(from.x, from.y);
      await sleep(150);
      await page.mouse.down();
      await sleep(120);
      await s.moveTo(from.x + 12, from.y + 4, 120);
      await s.moveTo(to.x, to.y, ms);
      await sleep(150);
      await page.mouse.up();
      await sleep(pause);
    },
    /** Shows a caption and waits long enough to read it (or `ms`). */
    async caption(html, { ms, top = false } = {}) {
      const words = html.replace(/<[^>]+>/g, "").split(/\s+/).length;
      if (!annotate) return sleep(Math.round((ms ?? Math.max(2600, 900 + words * 330)) * 0.55));
      await page.evaluate(([t, up]) => {
        const c = document.getElementById("wt-caption");
        c.innerHTML = t;
        c.classList.toggle("top", up);
        c.classList.add("on");
      }, [html, top]);
      if (process.env.WT_SHOTS) {
        fs.mkdirSync(process.env.WT_SHOTS, { recursive: true });
        await page.screenshot({ path: path.join(process.env.WT_SHOTS, `${String(++shots).padStart(3, "0")}.png`) });
      }
      await sleep(ms ?? Math.max(2600, 900 + words * 330));
    },
    async hideCaption() {
      if (!annotate) return;
      await page.evaluate(() => document.getElementById("wt-caption").classList.remove("on"));
      await sleep(300);
    },
    /** The label in the corner: which part of the walkthrough this is. */
    async chapter(text) {
      if (!annotate) return;
      await page.evaluate((t) => {
        const c = document.getElementById("wt-chapter");
        c.textContent = t;
        c.classList.toggle("on", !!t);
      }, text);
    },
    /** A full-screen title card. */
    async title(heading, text = "", { ms = 4200, small = "" } = {}) {
      if (!annotate) return sleep(800);
      await page.evaluate(([h, p, sm]) => {
        const t = document.getElementById("wt-title");
        t.innerHTML = `<h1></h1><p></p><small></small>`;
        t.querySelector("h1").textContent = h;
        t.querySelector("p").textContent = p;
        t.querySelector("small").textContent = sm;
        t.classList.add("on");
      }, [heading, text, small]);
      await sleep(ms);
      await page.evaluate(() => document.getElementById("wt-title").classList.remove("on"));
      await sleep(700);
    },
    /** Stops recording and writes the MP4. */
    async finish() {
      await sleep(600);
      await cdp.send("Page.stopScreencast").catch(() => {});
      await sleep(300);
      await browser.close();
      if (frames.length < 2) throw new Error("No frames were recorded.");
      frames.sort((a, b) => a.t - b.t);
      const lines = [];
      for (let i = 0; i < frames.length; i++) {
        const next = frames[i + 1]?.t ?? frames[i].t + 1;
        lines.push(`file '${frames[i].file}'`, `duration ${Math.max(0.001, next - frames[i].t).toFixed(4)}`);
      }
      lines.push(`file '${frames.at(-1).file}'`);
      const list = path.join(dir, "frames.txt");
      fs.writeFileSync(list, lines.join("\n") + "\n");
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list,
        "-vf", "fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "20",
        "-movflags", "+faststart", out]);
      fs.rmSync(dir, { recursive: true, force: true });
      return { out, seconds: frames.at(-1).t - frames[0].t, frames: frames.length, problems };
    },
  };
  return s;
}
