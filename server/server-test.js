console.log("================================");
console.log("NODE TEST BASLADI");
console.log("Node:", process.version);
console.log("PORT:", process.env.PORT);
console.log("================================");

const http = require("node:http");

const port = Number(process.env.PORT) || 8787;

const server = http.createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "application/json"
  });

  res.end(JSON.stringify({
    ok: true,
    message: "Node server çalışıyor",
    port: port
  }));
});

server.listen(port, "0.0.0.0", () => {
  console.log(
    `SERVER LISTENING ON 0.0.0.0:${port}`
  );
});