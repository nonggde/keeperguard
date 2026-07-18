import { createServer } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "web");
const port = Number(process.env.PORT || 4173);
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function resolveRequestPath(url) {
  const pathname = decodeURIComponent(new URL(url, "http://localhost").pathname);
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = path.resolve(root, relative);
  return candidate.startsWith(`${root}${path.sep}`) || candidate === root ? candidate : null;
}

export const server = createServer(async (request, response) => {
  const file = resolveRequestPath(request.url || "/");
  if (!file) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const body = await fs.readFile(file);
    response.writeHead(200, {
      "content-type": contentTypes[path.extname(file)] || "application/octet-stream",
      "cache-control": file.endsWith("index.html") ? "no-cache" : "public, max-age=60",
      "x-content-type-options": "nosniff"
    });
    response.end(body);
  } catch (error) {
    response.writeHead(error.code === "ENOENT" ? 404 : 500).end(error.code === "ENOENT" ? "Not found" : "Server error");
  }
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`KeeperGuard evidence console: http://127.0.0.1:${port}\n`);
});
