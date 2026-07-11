import { spawn } from "node:child_process";
import { createECDH, timingSafeEqual } from "node:crypto";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const VAPID_PUBLIC_KEY_NAME = "VAPID_PUBLIC_KEY";
export const VAPID_PRIVATE_KEY_NAME = "VAPID_PRIVATE_KEY";

const PUBLIC_KEY_PATTERN = /^B[A-Za-z0-9_-]{86}$/;
const PRIVATE_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const VARLOCK_LOCAL_REFERENCE_PATTERN = /^varlock\("local:[^"\r\n]+"\)$/;
const VARLOCK_LOCAL_REFERENCE_EXTRACT_PATTERN = /varlock\("local:[^"\r\n]+"\)/g;
const WRANGLER_ENV_ALLOWLIST = [
  "CI",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_BASE_URL",
  "CLOUDFLARE_API_TOKEN",
  "FORCE_COLOR",
  "HOME",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NODE_EXTRA_CA_CERTS",
  "NO_COLOR",
  "NO_PROXY",
  "PATH",
  "SSL_CERT_FILE",
  "TEMP",
  "TERM",
  "TMP",
  "TMPDIR",
  "USER",
  "XDG_CONFIG_HOME",
];
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function leftPad(buffer, length) {
  if (buffer.byteLength >= length) {
    return buffer;
  }

  return Buffer.concat([Buffer.alloc(length - buffer.byteLength), buffer]);
}

export function generateVapidKeyPair({ createCurve = () => createECDH("prime256v1") } = {}) {
  const curve = createCurve();
  curve.generateKeys();

  const publicKey = leftPad(Buffer.from(curve.getPublicKey()), 65).toString("base64url");
  const privateKey = leftPad(Buffer.from(curve.getPrivateKey()), 32).toString("base64url");

  return { publicKey, privateKey };
}

export function validateVapidKeyPair({ publicKey, privateKey }) {
  if (!PUBLIC_KEY_PATTERN.test(publicKey)) {
    throw new Error("VAPID public key must be an 87-character uncompressed P-256 base64url key");
  }

  if (!PRIVATE_KEY_PATTERN.test(privateKey)) {
    throw new Error("VAPID private key must be a 43-character P-256 base64url key");
  }

  const publicKeyBytes = Buffer.from(publicKey, "base64url");
  const privateKeyBytes = Buffer.from(privateKey, "base64url");
  if (publicKeyBytes.byteLength !== 65 || publicKeyBytes[0] !== 0x04) {
    throw new Error("VAPID public key is not an uncompressed P-256 point");
  }
  if (privateKeyBytes.byteLength !== 32) {
    throw new Error("VAPID private key is not a 32-byte P-256 scalar");
  }

  const curve = createECDH("prime256v1");
  try {
    curve.setPrivateKey(privateKeyBytes);
  } catch {
    throw new Error("VAPID private key is not a valid P-256 scalar");
  }

  const derivedPublicKey = leftPad(curve.getPublicKey(), 65);
  if (
    derivedPublicKey.byteLength !== publicKeyBytes.byteLength ||
    !timingSafeEqual(derivedPublicKey, publicKeyBytes)
  ) {
    throw new Error("VAPID public and private keys do not match");
  }
}

function findEnvironmentValue(contents, name) {
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (match?.[1] === name) {
      return match[2].trim() || undefined;
    }
  }

  return undefined;
}

function replaceEnvironmentValue(contents, name, value) {
  const lines = contents ? contents.split(/\r?\n/) : [];
  const replacement = `${name}=${value}`;
  let replaced = false;

  const updated = lines.map((line) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match?.[1] !== name) {
      return line;
    }

    if (replaced) {
      throw new Error(`${name} is defined more than once`);
    }
    replaced = true;
    return replacement;
  });

  if (!replaced) {
    while (updated.at(-1) === "") {
      updated.pop();
    }
    updated.push(replacement);
  }

  return `${updated.join("\n")}\n`;
}

async function readIfPresent(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

export async function readVapidEnvironment({ root = PROJECT_ROOT } = {}) {
  const [publicEnvironment, localEnvironment] = await Promise.all([
    readIfPresent(path.join(root, ".env")),
    readIfPresent(path.join(root, ".env.local")),
  ]);

  return {
    publicValue: findEnvironmentValue(publicEnvironment, VAPID_PUBLIC_KEY_NAME),
    privateReference: findEnvironmentValue(localEnvironment, VAPID_PRIVATE_KEY_NAME),
  };
}

async function atomicWrite(filePath, contents, mode) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, contents, { encoding: "utf8", mode });
  await chmod(temporaryPath, mode);
  await rename(temporaryPath, filePath);
}

export async function persistVapidEnvironment(
  { publicValue, privateReference },
  { root = PROJECT_ROOT } = {},
) {
  if (!VARLOCK_LOCAL_REFERENCE_PATTERN.test(privateReference)) {
    throw new Error(
      "Refusing to persist a VAPID private key that is not a local Varlock reference",
    );
  }

  const publicPath = path.join(root, ".env");
  const localPath = path.join(root, ".env.local");
  const [publicEnvironment, localEnvironment] = await Promise.all([
    readIfPresent(publicPath),
    readIfPresent(localPath),
  ]);

  const nextPublicEnvironment = replaceEnvironmentValue(
    publicEnvironment,
    VAPID_PUBLIC_KEY_NAME,
    publicValue,
  );
  const nextLocalEnvironment = replaceEnvironmentValue(
    localEnvironment,
    VAPID_PRIVATE_KEY_NAME,
    privateReference,
  );

  await atomicWrite(localPath, nextLocalEnvironment, 0o600);
  await atomicWrite(publicPath, nextPublicEnvironment, 0o644);
}

export function runChildProcess(
  command,
  args,
  { input, captureStdout = false, env = process.env, shell = false } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      shell,
      stdio: ["pipe", captureStdout ? "pipe" : "inherit", "inherit"],
    });
    const stdout = [];
    let settled = false;

    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    if (captureStdout) {
      child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    }
    child.once("error", rejectOnce);
    child.stdin.once("error", (error) => {
      if (error.code === "EPIPE" && child.pid === undefined) return;
      rejectOnce(error);
    });
    child.once("close", (exitCode) => {
      if (settled) return;
      settled = true;
      resolve({
        exitCode: exitCode ?? 1,
        stdout: captureStdout ? Buffer.concat(stdout).toString("utf8") : undefined,
      });
    });
    child.stdin.end(input);
  });
}

function localBinary(name) {
  return path.join(PROJECT_ROOT, "node_modules", ".bin", name);
}

function selectWranglerEnvironment(environment) {
  return Object.fromEntries(
    WRANGLER_ENV_ALLOWLIST.flatMap((name) =>
      environment[name] === undefined ? [] : [[name, environment[name]]],
    ),
  );
}

function parseJsonArray(stdout, description) {
  try {
    const parsed = JSON.parse(stdout ?? "");
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // The caller reports a value-free error below.
  }
  throw new Error(`Wrangler returned invalid JSON for ${description}`);
}

export async function encryptVapidPrivateKey(
  privateKey,
  { runProcess = runChildProcess, varlockPath = localBinary("varlock") } = {},
) {
  const result = await runProcess(varlockPath, ["encrypt"], {
    input: `${privateKey}\n`,
    captureStdout: true,
    shell: false,
  });
  if (result.exitCode !== 0) {
    throw new Error(`Varlock encryption exited with code ${result.exitCode}`);
  }

  const references = result.stdout?.match(VARLOCK_LOCAL_REFERENCE_EXTRACT_PATTERN) ?? [];
  if (references.length !== 1 || !VARLOCK_LOCAL_REFERENCE_PATTERN.test(references[0])) {
    throw new Error("Varlock did not return a valid local encrypted reference");
  }

  return references[0];
}

export async function generateAndPersistVapidKeys({
  rotate = false,
  readEnvironment = readVapidEnvironment,
  generatePair = generateVapidKeyPair,
  validatePair = validateVapidKeyPair,
  encryptPrivateKey = encryptVapidPrivateKey,
  persistEnvironment = persistVapidEnvironment,
  log = console.log,
} = {}) {
  const current = await readEnvironment();
  if (!rotate && (current.publicValue || current.privateReference)) {
    throw new Error("VAPID keys already exist; pass --rotate to replace them intentionally");
  }

  const pair = generatePair();
  validatePair(pair);
  const privateReference = await encryptPrivateKey(pair.privateKey);
  await persistEnvironment({ publicValue: pair.publicKey, privateReference });

  log(`VAPID public key: ${pair.publicKey}`);
  log("The private key recovery copy is encrypted in .env.local and was not displayed.");
  return { publicKey: pair.publicKey };
}

export async function provisionVapidPrivateKey({
  publicKey = process.env[VAPID_PUBLIC_KEY_NAME],
  privateKey = process.env[VAPID_PRIVATE_KEY_NAME],
  processEnvironment = process.env,
  profile,
  validatePair = validateVapidKeyPair,
  runProcess = runChildProcess,
  wranglerPath = localBinary("wrangler"),
  log = console.log,
} = {}) {
  if (!publicKey || !privateKey) {
    throw new Error("VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be resolved by Varlock");
  }

  validatePair({ publicKey, privateKey });
  const childEnvironment = selectWranglerEnvironment(processEnvironment);
  const targetArgs = ["--name", "kestrel", "--config", "wrangler.toml"];
  if (profile) {
    targetArgs.push("--profile", profile);
  }

  const commonOptions = { env: childEnvironment, shell: false };
  const preflight = await runProcess(
    wranglerPath,
    ["deployments", "list", ...targetArgs, "--json"],
    { ...commonOptions, captureStdout: true },
  );
  if (preflight.exitCode !== 0) {
    throw new Error("Could not confirm the exact root Worker kestrel; no secret was uploaded");
  }
  let deployments;
  try {
    deployments = parseJsonArray(preflight.stdout, "the kestrel deployment preflight");
  } catch {
    throw new Error("Could not confirm the exact root Worker kestrel; preflight was invalid");
  }
  if (deployments.length === 0) {
    throw new Error("Could not confirm the exact root Worker kestrel; no deployments exist");
  }

  const upload = await runProcess(
    wranglerPath,
    ["secret", "put", VAPID_PRIVATE_KEY_NAME, ...targetArgs],
    { ...commonOptions, input: `${privateKey}\n` },
  );
  const verification = await runProcess(
    wranglerPath,
    ["secret", "list", ...targetArgs, "--format", "json"],
    { ...commonOptions, captureStdout: true },
  );

  let isVerified = false;
  if (verification.exitCode === 0) {
    try {
      const secrets = parseJsonArray(verification.stdout, "the name-only secret check");
      const vapidSecret = secrets.find(
        (secret) => secret && typeof secret === "object" && secret.name === VAPID_PRIVATE_KEY_NAME,
      );
      isVerified = Boolean(
        vapidSecret && !Object.prototype.hasOwnProperty.call(vapidSecret, "value"),
      );
    } catch {
      isVerified = false;
    }
  }

  if (upload.exitCode !== 0) {
    if (isVerified) {
      throw new Error(
        "The secret name exists, but the failed upload means Cloudflare cannot prove which private value is active. Do not retry automatically; inspect the Worker version before deciding whether to retry or rotate.",
      );
    }
    throw new Error(
      "The secret upload result was ambiguous. Complete a name-only secret check before retrying so an already-applied secret is not rotated.",
    );
  }
  if (!isVerified) {
    throw new Error(`The name-only secret check did not confirm ${VAPID_PRIVATE_KEY_NAME}`);
  }

  log(`Provisioned and verified ${VAPID_PRIVATE_KEY_NAME} without displaying its value.`);
}

export function parseCommandOptions(args) {
  const [command, ...options] = args;
  if (options.includes("--env")) {
    throw new Error("Named environments are not configured in wrangler.toml; --env is not allowed");
  }

  if (command === "generate") {
    if (options.length === 0) {
      return { command, rotate: false };
    }
    if (options.length === 1 && options[0] === "--rotate") {
      return { command, rotate: true };
    }
    throw new Error("generate accepts only --rotate");
  }

  if (command === "provision") {
    if (options.length === 0) {
      return { command };
    }
    if (options.length === 2 && options[0] === "--profile" && options[1]) {
      return { command, profile: options[1] };
    }
    throw new Error("provision accepts only --profile NAME");
  }

  throw new Error("Usage: node scripts/vapid.mjs <generate|provision>");
}

async function main() {
  const options = parseCommandOptions(process.argv.slice(2));

  if (options.command === "generate") {
    await generateAndPersistVapidKeys({ rotate: options.rotate });
    return;
  }
  if (options.command === "provision") {
    await provisionVapidPrivateKey({
      profile: options.profile,
    });
    return;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "VAPID command failed");
    process.exitCode = 1;
  });
}
