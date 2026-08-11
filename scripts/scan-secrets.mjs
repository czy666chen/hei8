import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";

const textExtensions = new Set([
  "", ".css", ".html", ".js", ".json", ".jsonc", ".md", ".mjs", ".sql", ".ts", ".tsx", ".txt", ".vars", ".yml", ".yaml",
]);
const secretAssignment = /(?:REGISTRATION_INVITE_CODE|PASSWORD_HMAC_KEY|SESSION_HMAC_KEY)\s*[:=]\s*["']?(?!replace-with-|process\.env|env\.)[^\s"',;}]{8,}/g;
const privateKey = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g;

const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], {
  encoding: "utf8",
})
  .split(/\r?\n/)
  .filter(Boolean);

function collectFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(path) : [path];
  });
}

for (const root of [".vinext", "dist", "dist-static"]) {
  files.push(...collectFiles(root));
}

const findings = [];
for (const file of files) {
  if (file === ".dev.vars.example" || !textExtensions.has(extname(file).toLowerCase())) continue;

  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }

  for (const [name, pattern] of [
    ["R3 secret assignment", secretAssignment],
    ["private key", privateKey],
  ]) {
    pattern.lastIndex = 0;
    if (pattern.test(content)) findings.push(`${file}: possible ${name}`);
  }
}

if (findings.length > 0) {
  console.error(findings.join("\n"));
  process.exit(1);
}

console.log(`Secret scan passed (${files.length} files checked).`);
