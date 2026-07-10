import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  encryptVapidPrivateKey,
  generateAndPersistVapidKeys,
  generateVapidKeyPair,
  parseCommandOptions,
  persistVapidEnvironment,
  provisionVapidPrivateKey,
  readVapidEnvironment,
  runChildProcess,
  validateVapidKeyPair,
} from "./vapid.mjs";

const TEST_PUBLIC_KEY = `B${"A".repeat(86)}`;
const TEST_PRIVATE_KEY = "c".repeat(43);

void test("runChildProcess keeps a dummy secret on stdin and out of argv and env", async () => {
  const dummySecret = "test-only-stdin-secret";
  const fixture = [
    "let stdin = '';",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', (chunk) => { stdin += chunk; });",
    "process.stdin.on('end', () => {",
    "  process.stdout.write(JSON.stringify({ stdin, argv: process.argv.slice(1), env: process.env.DUMMY_SECRET }));",
    "});",
  ].join("\n");

  const result = await runChildProcess(process.execPath, ["-e", fixture, "visible-argument"], {
    captureStdout: true,
    env: { PATH: process.env.PATH },
    input: `${dummySecret}\n`,
    shell: false,
  });
  const observed = JSON.parse(result.stdout);

  assert.equal(result.exitCode, 0);
  assert.equal(observed.stdin, `${dummySecret}\n`);
  assert.equal(JSON.stringify(observed.argv).includes(dummySecret), false);
  assert.equal(observed.env, undefined);
});

void test("runChildProcess rejects a missing executable predictably", async () => {
  await assert.rejects(
    runChildProcess("/definitely/missing/kestrel-command", [], { input: "dummy\n", shell: false }),
    (error) => error?.code === "ENOENT",
  );
});

void test("runChildProcess rejects a child stdin EPIPE predictably", async () => {
  const fixture = "require('node:fs').closeSync(0); setTimeout(() => {}, 100);";
  const input = Buffer.alloc(8 * 1024 * 1024, 0x61);

  await assert.rejects(
    runChildProcess(process.execPath, ["-e", fixture], { input, shell: false }),
    (error) => error?.code === "EPIPE",
  );
});

void test("parseCommandOptions enforces command-specific options", () => {
  assert.deepEqual(parseCommandOptions(["generate"]), { command: "generate", rotate: false });
  assert.deepEqual(parseCommandOptions(["generate", "--rotate"]), {
    command: "generate",
    rotate: true,
  });
  assert.deepEqual(parseCommandOptions(["provision", "--profile", "production-account"]), {
    command: "provision",
    profile: "production-account",
  });

  assert.throws(
    () => parseCommandOptions(["generate", "--profile", "wrong"]),
    /generate.*--rotate/i,
  );
  assert.throws(() => parseCommandOptions(["provision", "--rotate"]), /provision.*--profile/i);
  assert.throws(
    () => parseCommandOptions(["provision", "--env", "production"]),
    /named environments/i,
  );
});

void test("generateVapidKeyPair pads P-256 keys before base64url encoding", () => {
  const pair = generateVapidKeyPair({
    createCurve() {
      return {
        generateKeys() {},
        getPrivateKey() {
          return Buffer.from([0x01]);
        },
        getPublicKey() {
          return Buffer.from([0x04, 0x02]);
        },
      };
    },
  });

  assert.equal(Buffer.from(pair.privateKey, "base64url").byteLength, 32);
  assert.equal(Buffer.from(pair.publicKey, "base64url").byteLength, 65);
  assert.equal(pair.privateKey.includes("="), false);
  assert.equal(pair.publicKey.includes("="), false);
});

void test("validateVapidKeyPair accepts a generated pair and rejects a mismatch", () => {
  const first = generateVapidKeyPair();
  const second = generateVapidKeyPair();

  assert.doesNotThrow(() => validateVapidKeyPair(first));
  assert.throws(
    () => validateVapidKeyPair({ publicKey: first.publicKey, privateKey: second.privateKey }),
    /do not match/,
  );
});

void test("generateAndPersistVapidKeys refuses accidental rotation", async () => {
  let generated = false;

  await assert.rejects(
    generateAndPersistVapidKeys({
      readEnvironment: async () => ({
        publicValue: TEST_PUBLIC_KEY,
        privateReference: 'varlock("local:already-encrypted")',
      }),
      generatePair() {
        generated = true;
        return { publicKey: TEST_PUBLIC_KEY, privateKey: TEST_PRIVATE_KEY };
      },
    }),
    /already exist.*--rotate/i,
  );

  assert.equal(generated, false);
});

void test("generateAndPersistVapidKeys encrypts through stdin and persists no plaintext private key", async () => {
  const writes = [];
  const encryptedInputs = [];
  const logs = [];

  const pair = await generateAndPersistVapidKeys({
    readEnvironment: async () => ({ publicValue: undefined, privateReference: undefined }),
    generatePair: () => ({ publicKey: TEST_PUBLIC_KEY, privateKey: TEST_PRIVATE_KEY }),
    validatePair() {},
    async encryptPrivateKey(privateKey) {
      encryptedInputs.push(privateKey);
      return 'varlock("local:test-encrypted-reference")';
    },
    async persistEnvironment(environment) {
      writes.push(environment);
    },
    log(message) {
      logs.push(message);
    },
  });

  assert.deepEqual(encryptedInputs, [TEST_PRIVATE_KEY]);
  assert.deepEqual(writes, [
    {
      publicValue: TEST_PUBLIC_KEY,
      privateReference: 'varlock("local:test-encrypted-reference")',
    },
  ]);
  assert.equal(JSON.stringify(writes).includes(TEST_PRIVATE_KEY), false);
  assert.equal(logs.join("\n").includes(TEST_PRIVATE_KEY), false);
  assert.deepEqual(pair, { publicKey: TEST_PUBLIC_KEY });
});

void test("generateAndPersistVapidKeys never reports success after a persistence failure", async () => {
  const logs = [];

  await assert.rejects(
    generateAndPersistVapidKeys({
      readEnvironment: async () => ({ publicValue: undefined, privateReference: undefined }),
      generatePair: () => ({ publicKey: TEST_PUBLIC_KEY, privateKey: TEST_PRIVATE_KEY }),
      validatePair() {},
      encryptPrivateKey: async () => 'varlock("local:test-encrypted-reference")',
      persistEnvironment: async () => {
        throw new Error("simulated persistence failure");
      },
      log(message) {
        logs.push(message);
      },
    }),
    /simulated persistence failure/,
  );

  assert.deepEqual(logs, []);
});

void test("encryptVapidPrivateKey passes plaintext only on Varlock stdin", async () => {
  const calls = [];

  const reference = await encryptVapidPrivateKey(TEST_PRIVATE_KEY, {
    varlockPath: "/workspace/node_modules/.bin/varlock",
    async runProcess(command, args, options) {
      calls.push({ command, args, options });
      return {
        exitCode: 0,
        stdout: 'varlock("local:test-encrypted-reference")\n',
      };
    },
  });

  assert.equal(reference, 'varlock("local:test-encrypted-reference")');
  assert.equal(calls[0].command, "/workspace/node_modules/.bin/varlock");
  assert.deepEqual(calls[0].args, ["encrypt"]);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.input, `${TEST_PRIVATE_KEY}\n`);
  assert.equal(calls[0].args.join(" ").includes(TEST_PRIVATE_KEY), false);
});

void test("persistVapidEnvironment keeps only the encrypted private reference on disk", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kestrel-vapid-"));
  try {
    await writeFile(path.join(root, ".env"), "APP_ENV=development\n", "utf8");
    await writeFile(path.join(root, ".env.local"), "API_BEARER_SECRET=varlock(prompt)\n", "utf8");

    await persistVapidEnvironment(
      {
        publicValue: TEST_PUBLIC_KEY,
        privateReference: 'varlock("local:test-encrypted-reference")',
      },
      { root },
    );

    const publicEnvironment = await readFile(path.join(root, ".env"), "utf8");
    const localEnvironment = await readFile(path.join(root, ".env.local"), "utf8");
    const localMode = (await stat(path.join(root, ".env.local"))).mode & 0o777;

    assert.match(publicEnvironment, new RegExp(`^VAPID_PUBLIC_KEY=${TEST_PUBLIC_KEY}$`, "m"));
    assert.match(localEnvironment, /^API_BEARER_SECRET=varlock\(prompt\)$/m);
    assert.match(
      localEnvironment,
      /^VAPID_PRIVATE_KEY=varlock\("local:test-encrypted-reference"\)$/m,
    );
    assert.equal(localEnvironment.includes(TEST_PRIVATE_KEY), false);
    assert.equal(localMode, 0o600);
    assert.deepEqual(await readVapidEnvironment({ root }), {
      publicValue: TEST_PUBLIC_KEY,
      privateReference: 'varlock("local:test-encrypted-reference")',
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("provisionVapidPrivateKey sends the private key only on Wrangler stdin", async () => {
  const calls = [];
  const logs = [];

  await provisionVapidPrivateKey({
    publicKey: TEST_PUBLIC_KEY,
    privateKey: TEST_PRIVATE_KEY,
    processEnvironment: {
      API_BEARER_SECRET: "test-only-bearer-value",
      CLOUDFLARE_API_TOKEN: "test-only-cloudflare-token",
      FUTURE_SECRET: "must-not-reach-wrangler",
      HOME: "/home/tester",
      PATH: "/usr/bin",
      VAPID_PRIVATE_KEY: TEST_PRIVATE_KEY,
    },
    profile: "production-account",
    validatePair() {},
    wranglerPath: "/workspace/node_modules/.bin/wrangler",
    async runProcess(command, args, options) {
      calls.push({ command, args, options });
      if (args[0] === "deployments") {
        return { exitCode: 0, stdout: '[{"id":"existing-deployment"}]' };
      }
      if (args[1] === "put") {
        return { exitCode: 0 };
      }
      return {
        exitCode: 0,
        stdout: '[{"name":"VAPID_PRIVATE_KEY","type":"secret_text"}]',
      };
    },
    log(message) {
      logs.push(message);
    },
  });

  assert.equal(calls.length, 3);
  assert.equal(
    calls.every((call) => call.command === "/workspace/node_modules/.bin/wrangler"),
    true,
  );
  assert.deepEqual(calls[0].args, [
    "deployments",
    "list",
    "--name",
    "kestrel",
    "--config",
    "wrangler.toml",
    "--profile",
    "production-account",
    "--json",
  ]);
  assert.deepEqual(calls[1].args, [
    "secret",
    "put",
    "VAPID_PRIVATE_KEY",
    "--name",
    "kestrel",
    "--config",
    "wrangler.toml",
    "--profile",
    "production-account",
  ]);
  assert.deepEqual(calls[2].args, [
    "secret",
    "list",
    "--name",
    "kestrel",
    "--config",
    "wrangler.toml",
    "--profile",
    "production-account",
    "--format",
    "json",
  ]);
  assert.equal(calls[1].options.shell, false);
  assert.equal(calls[1].options.input, `${TEST_PRIVATE_KEY}\n`);
  assert.deepEqual(calls[1].options.env, {
    CLOUDFLARE_API_TOKEN: "test-only-cloudflare-token",
    HOME: "/home/tester",
    PATH: "/usr/bin",
  });
  assert.equal(
    calls.some((call) => call.args.join(" ").includes(TEST_PRIVATE_KEY)),
    false,
  );
  assert.equal(logs.join("\n").includes(TEST_PRIVATE_KEY), false);
});

void test("provisionVapidPrivateKey stops when the exact root Worker preflight fails", async () => {
  const calls = [];

  await assert.rejects(
    provisionVapidPrivateKey({
      publicKey: TEST_PUBLIC_KEY,
      privateKey: TEST_PRIVATE_KEY,
      validatePair() {},
      async runProcess(command, args, options) {
        calls.push({ command, args, options });
        return { exitCode: 1, stdout: "" };
      },
    }),
    /could not confirm.*kestrel/i,
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.input, undefined);
});

void test("provisionVapidPrivateKey verifies an ambiguous put before advising a retry", async () => {
  const logs = [];
  const calls = [];

  await assert.rejects(
    provisionVapidPrivateKey({
      publicKey: TEST_PUBLIC_KEY,
      privateKey: TEST_PRIVATE_KEY,
      validatePair() {},
      async runProcess(command, args, options) {
        calls.push({ command, args, options });
        if (args[0] === "deployments") {
          return { exitCode: 0, stdout: '[{"id":"existing-deployment"}]' };
        }
        if (args[1] === "put") {
          return { exitCode: 1 };
        }
        return { exitCode: 0, stdout: "not-json" };
      },
      log(message) {
        logs.push(message);
      },
    }),
    /name-only secret check.*before retrying/i,
  );

  assert.deepEqual(
    calls.map((call) => call.args.slice(0, 2)),
    [
      ["deployments", "list"],
      ["secret", "put"],
      ["secret", "list"],
    ],
  );
  assert.equal(logs.join("\n").includes(TEST_PRIVATE_KEY), false);
});

void test("provisionVapidPrivateKey never treats an existing secret name as proof of a failed upload", async () => {
  const logs = [];

  await assert.rejects(
    provisionVapidPrivateKey({
      publicKey: TEST_PUBLIC_KEY,
      privateKey: TEST_PRIVATE_KEY,
      validatePair() {},
      async runProcess(_command, args) {
        if (args[0] === "deployments") {
          return { exitCode: 0, stdout: '[{"id":"existing-deployment"}]' };
        }
        if (args[1] === "put") {
          return { exitCode: 1 };
        }
        return {
          exitCode: 0,
          stdout: '[{"name":"VAPID_PRIVATE_KEY","type":"secret_text"}]',
        };
      },
      log(message) {
        logs.push(message);
      },
    }),
    /cannot prove which private value is active.*do not retry automatically/i,
  );

  assert.deepEqual(logs, []);
});

void test("provisionVapidPrivateKey rejects a successful upload without name-only verification", async () => {
  await assert.rejects(
    provisionVapidPrivateKey({
      publicKey: TEST_PUBLIC_KEY,
      privateKey: TEST_PRIVATE_KEY,
      validatePair() {},
      async runProcess(_command, args) {
        if (args[0] === "deployments") {
          return { exitCode: 0, stdout: '[{"id":"existing-deployment"}]' };
        }
        if (args[1] === "put") {
          return { exitCode: 0 };
        }
        return { exitCode: 0, stdout: "[]" };
      },
    }),
    /did not confirm VAPID_PRIVATE_KEY/i,
  );
});
