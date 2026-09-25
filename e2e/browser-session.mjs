// Sets a cookie on the running e2e server via a tiny redirect page is not possible;
// instead print the cookie value for a given actor so the browser can be pointed with it.
import fs from "node:fs";
const s=JSON.parse(fs.readFileSync("e2e/.sessions.json","utf8"));
console.log(s[process.argv[2]||"admin"].token);
