// Starts and stops the e2e run's own `next dev` for apps/web. Only ever kills processes it started
// or, as a last resort, a listener on the port whose command line is inside this worktree.
import { execFileSync, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { ROOT, WEB_DIR } from "./env.mjs";

const IS_WINDOWS = process.platform === "win32";

function canConnect(port, host) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

export async function portInUse(port) {
  return (await canConnect(port, "127.0.0.1")) || (await canConnect(port, "::1"));
}

/** PIDs listening on `port` (Windows: netstat; elsewhere: lsof when available). */
function listenerPids(port) {
  try {
    if (IS_WINDOWS) {
      const out = execFileSync("netstat", ["-ano", "-p", "TCP"], { encoding: "utf8" });
      const pids = new Set();
      for (const line of out.split(/\r?\n/)) {
        const cols = line.trim().split(/\s+/);
        if (cols.length >= 5 && cols[3] === "LISTENING" && cols[1].endsWith(`:${port}`)) pids.add(Number(cols[4]));
      }
      return [...pids].filter((pid) => pid > 0);
    }
    const out = execFileSync("lsof", ["-t", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
    return out.split(/\s+/).filter(Boolean).map(Number);
  } catch {
    return [];
  }
}

function commandLineOf(pid) {
  try {
    if (IS_WINDOWS) {
      return execFileSync(
        "powershell",
        ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`],
        { encoding: "utf8" },
      ).trim();
    }
    return execFileSync("ps", ["-o", "args=", "-p", String(pid)], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function killTree(pid) {
  try {
    if (IS_WINDOWS) execFileSync("taskkill", ["/T", "/F", "/PID", String(pid)], { stdio: "ignore" });
    else process.kill(-pid, "SIGKILL");
  } catch {
    // Already gone.
  }
}

const normalize = (path) => path.replaceAll("\\", "/").toLowerCase();

async function waitPortFree(port, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (!(await portInUse(port))) return true;
    await sleep(500);
  }
  return false;
}

/**
 * Spawns `next dev -p <port>` in apps/web. `env` overrides win over .env.local (Next never
 * overwrites variables that are already set). Server output goes to `logFile`.
 */
export async function startDevServer({ port, env, logFile, readyTimeoutMs = 180_000 }) {
  if (await portInUse(port)) throw new Error(`Port ${port} is already in use. Stop that server or pass --base-url.`);
  const nextBin = createRequire(`${WEB_DIR}/package.json`).resolve("next/dist/bin/next");
  const log = createWriteStream(logFile);
  const child = spawn(process.execPath, [nextBin, "dev", "-p", String(port)], {
    cwd: WEB_DIR,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: !IS_WINDOWS,
    windowsHide: true,
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  let exited = false;
  child.once("exit", () => {
    exited = true;
  });

  const server = { port, child, baseUrl: `http://localhost:${port}` };
  const deadline = Date.now() + readyTimeoutMs;
  while (Date.now() < deadline) {
    if (exited) throw new Error(`next dev exited early; see ${logFile}`);
    try {
      const res = await fetch(`${server.baseUrl}/login`, { signal: AbortSignal.timeout(120_000) });
      if (res.status === 200) return server;
    } catch {
      // Not listening or still compiling.
    }
    await sleep(1000);
  }
  await stopDevServer(server);
  throw new Error(`next dev was not ready after ${readyTimeoutMs / 1000}s; see ${logFile}`);
}

/** Ctrl+C: kill the tree right away (the async stop below cannot run in a signal handler). */
export function killDevServerNow(server) {
  if (server.child.pid) killTree(server.child.pid);
}

/** Kills the whole server tree, then checks the port. Returns a one-line status. */
export async function stopDevServer(server) {
  if (server.child.pid) killTree(server.child.pid);
  if (await waitPortFree(server.port, 15_000)) return `port ${server.port} free`;

  // `next dev` can leave its `start-server.js` child holding the port.
  const killed = [];
  for (const pid of listenerPids(server.port)) {
    const cmd = commandLineOf(pid);
    if (cmd && normalize(cmd).includes(normalize(ROOT))) {
      killTree(pid);
      killed.push(pid);
    }
  }
  if (await waitPortFree(server.port, 10_000)) return `port ${server.port} free (killed leftover pid ${killed.join(", ")})`;
  return `port ${server.port} STILL IN USE by a process outside this worktree; not touched`;
}

/** Compiles the routes the scenarios hit so the first real request does not time out. */
export async function warmUp(baseUrl) {
  const hits = [
    ["GET", "/login"],
    ["POST", "/api/chat"],
  ];
  for (const [method, path] of hits) {
    try {
      await fetch(`${baseUrl}${path}`, {
        method,
        headers: method === "POST" ? { "content-type": "application/json" } : undefined,
        body: method === "POST" ? "{}" : undefined,
        redirect: "manual",
        signal: AbortSignal.timeout(180_000),
      });
    } catch {
      // Warm-up only.
    }
  }
}
