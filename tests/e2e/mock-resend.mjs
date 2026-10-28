// Stand-in for the Resend API so end-to-end tests can read the emails the app really sends and follow their links.
// POST /emails (what the app calls)  |  GET /outbox?to=<addr>  |  DELETE /outbox  |  GET /health
import { createServer } from "node:http";

const box = [];

createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const json = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  if (u.pathname === "/health") return res.end("ok");
  if (req.method === "POST" && u.pathname === "/emails") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const m = JSON.parse(raw);
      for (const to of m.to ?? []) box.push({ to: String(to).toLowerCase(), subject: m.subject, text: m.text, headers: m.headers ?? {}, at: Date.now() });
      json(200, { id: `mock_${box.length}` });
    });
    return;
  }
  if (req.method === "GET" && u.pathname === "/outbox") {
    const to = u.searchParams.get("to")?.toLowerCase();
    return json(200, box.filter((m) => !to || m.to === to));
  }
  if (req.method === "DELETE" && u.pathname === "/outbox") { box.length = 0; return json(200, { ok: true }); }
  json(404, { error: "not found" });
}).listen(Number(process.env.E2E_MAIL_PORT ?? 4100), () => console.log("mock resend on", process.env.E2E_MAIL_PORT ?? 4100));
