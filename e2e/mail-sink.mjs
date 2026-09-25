// Minimal SMTP sink for the E2E campaign: accepts every message on 127.0.0.1:2525 and
// writes it to e2e/mail/<seq>.eml plus an index line (to, subject). Nothing leaves the machine.
import net from "node:net";
import fs from "node:fs";

const dir = new URL("./mail/", import.meta.url);
fs.mkdirSync(dir, { recursive: true });
let seq = fs.readdirSync(dir).filter((f) => f.endsWith(".eml")).length;

net
  .createServer((sock) => {
    let data = false;
    let buf = "";
    let rcpt = [];
    sock.write("220 e2e-sink\r\n");
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      for (;;) {
        if (data) {
          const end = buf.indexOf("\r\n.\r\n");
          if (end === -1) return;
          const msg = buf.slice(0, end);
          buf = buf.slice(end + 5);
          data = false;
          const n = String(++seq).padStart(4, "0");
          fs.writeFileSync(new URL(`${n}.eml`, dir), msg);
          const subject = (msg.match(/^Subject: (.*)$/im) || [])[1] || "";
          fs.appendFileSync(new URL("index.jsonl", dir), JSON.stringify({ n, at: new Date().toISOString(), to: rcpt, subject }) + "\n");
          rcpt = [];
          sock.write("250 OK\r\n");
          continue;
        }
        const i = buf.indexOf("\r\n");
        if (i === -1) return;
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === "EHLO" || cmd === "HELO") sock.write("250 e2e-sink\r\n");
        else if (cmd === "RCPT") {
          rcpt.push(line.replace(/^RCPT TO:\s*/i, ""));
          sock.write("250 OK\r\n");
        } else if (cmd === "DATA") {
          data = true;
          sock.write("354 go\r\n");
        } else if (cmd === "QUIT") {
          sock.write("221 bye\r\n");
          sock.end();
          return;
        } else sock.write("250 OK\r\n");
      }
    });
    sock.on("error", () => {});
  })
  .listen(2525, "127.0.0.1", () => console.log("mail sink on 127.0.0.1:2525"));
