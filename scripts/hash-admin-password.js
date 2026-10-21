const crypto = require("node:crypto");

function readHiddenPassword() {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    return new Promise((resolve, reject) => {
      let value = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => {
        value += chunk;
        const lineEnd = value.indexOf("\n");
        if (lineEnd !== -1) {
          process.stdin.pause();
          resolve(value.slice(0, lineEnd).replace(/\r$/, ""));
        }
      });
      process.stdin.on("end", () => resolve(value.trimEnd()));
      process.stdin.on("error", reject);
    });
  }

  return new Promise((resolve, reject) => {
    let value = "";
    process.stdout.write("Admin password (12+ characters; input is hidden): ");
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
    };
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === "\u0003") {
          cleanup();
          process.stdout.write("\nCancelled.\n");
          reject(new Error("Password generation cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
        } else if (character >= " ") {
          value += character;
        }
      }
    };
    process.stdin.on("data", onData);
  });
}

async function main() {
  const password = await readHiddenPassword();
  if (password.length < 12) {
    throw new Error("Admin password must be at least 12 characters long.");
  }
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  process.stdout.write(`ADMIN_PASSWORD_HASH=scrypt$${salt}$${hash}\n`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});