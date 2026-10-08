import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { upsertEnvLine } from "./lib/env-file";

const ENV_FILE = ".env.local";
const current = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
const privateKey = generatePrivateKey();
writeFileSync(ENV_FILE, upsertEnvLine(current, "OPERATOR_PRIVATE_KEY", privateKey));
chmodSync(ENV_FILE, 0o600);
console.log(`Operator address: ${privateKeyToAccount(privateKey).address}`);
console.log(`The private key was written to ${ENV_FILE} and is not shown here.`);
