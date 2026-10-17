export function buildChromeArgs({ userData, port, allowNoSandbox = false }) {
  if (!userData) throw new Error("userData is required");
  if (!Number.isInteger(port) || port <= 0) throw new Error("a positive integer port is required");

  const args = ["--headless=new"];
  if (allowNoSandbox) args.push("--no-sandbox");
  args.push(
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${userData}`,
    `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1",
    "about:blank",
  );
  return args;
}
