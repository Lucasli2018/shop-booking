// shop-booking 页面 JS 探针：真实时钟，捕获 console 错误 + 关键断言
// 用法：node tests/probe.js http://127.0.0.1:8802
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const BASE = process.argv[2] || "http://127.0.0.1:8802";
const results = [];
const assert = (name, ok) => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); };

async function main() {
  const port = 9333;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "sb-probe-"));
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run",
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    "--window-size=420,900", "about:blank",
  ], { stdio: "ignore" });

  // 等 devtools 端口就绪
  let targets = null;
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 250));
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      targets = await res.json();
      if (targets.some(t => t.type === "page")) break;
    } catch (_) {}
  }
  const page = targets.find(t => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);

  let id = 0;
  const pending = new Map();
  const consoleErrors = [];
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      consoleErrors.push(msg.params.args.map(a => a.value || a.description || "").join(" "));
    }
    if (msg.method === "Runtime.exceptionThrown") {
      consoleErrors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text || "");
    }
  };
  const send = (method, params = {}) => new Promise(resolve => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const evalJs = async expr => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result?.result?.value;
  };

  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.navigate", { url: `${BASE}/?shop=tonys-hair` });
  await new Promise(r => setTimeout(r, 5000));

  assert("店铺名渲染", (await evalJs(`document.getElementById("shopName").textContent`)) === "Tony's 美发");
  if (results.some(r => !r.ok)) {
    console.log("DEBUG grid:", (await evalJs(`document.getElementById("serviceGrid").innerHTML.slice(0, 300)`)));
    console.log("DEBUG catRow:", (await evalJs(`document.getElementById("categoryRow") ? document.getElementById("categoryRow").innerHTML.slice(0, 200) : "NO ELEMENT"`)));
  }
  assert("hero 填充", (await evalJs(`document.getElementById("heroName").textContent`)) === "Tony's 美发");
  assert("分类 chips 出现", (await evalJs(`document.querySelectorAll(".cat-chip").length`)) >= 3);
  if (results.some(r => !r.ok)) {
    console.log("DEBUG chips raw:", (await evalJs(`document.querySelectorAll(".cat-chip").length`)));
    console.log("DEBUG grid:", (await evalJs(`document.getElementById("serviceGrid").innerHTML.slice(0, 300)`)));
    console.log("DEBUG services:", (await evalJs(`window.__svcLen || "unset"`)));
  }
  assert("服务卡片渲染", (await evalJs(`document.querySelectorAll(".service-card").length`)) === 6);

  // 点击分类筛选
  await evalJs(`document.querySelector('.cat-chip[data-cat="染烫"]').click()`);
  await new Promise(r => setTimeout(r, 200));
  assert("分类筛选生效", (await evalJs(`document.querySelectorAll(".service-card").length`)) === 2);
  await evalJs(`document.querySelector('.cat-chip[data-cat="全部"]').click()`);

  // 选服务 → 时间区出现 → 选日期已有默认 → 槽位加载
  await evalJs(`document.querySelector(".service-card").click()`);
  await new Promise(r => setTimeout(r, 1500));
  assert("时段区显示", (await evalJs(`!document.getElementById("timeSection").classList.contains("hidden")`)));
  assert("时段有可选项", (await evalJs(`document.querySelectorAll(".slot:not(.disabled)").length`)) > 0);

  // 我的预约弹窗打开
  await evalJs(`document.getElementById("myBookingsBtn").click()`);
  assert("我的预约弹窗", (await evalJs(`!document.getElementById("myBookingsModal").classList.contains("hidden")`)));

  assert("无 JS 报错", consoleErrors.length === 0);
  if (consoleErrors.length) console.log("JS errors:", consoleErrors);

  chrome.kill();
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error("probe failed:", e); process.exit(1); });
