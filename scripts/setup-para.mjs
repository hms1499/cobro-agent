// postinstall: runs Para's setup-para CLI, which stubs optional wallet-connector packages.
// Para 3.23 nests @getpara/react-sdk-lite under @getpara/react-sdk (an upstream peer conflict),
// so `npx setup-para` no longer finds the bin and runs a registry placeholder that exits 1.
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

const candidates = [
  "node_modules/@getpara/react-sdk-lite/dist/cli/cli.mjs",
  "node_modules/@getpara/react-sdk/node_modules/@getpara/react-sdk-lite/dist/cli/cli.mjs",
];
const cli = candidates.find((file) => existsSync(file));
if (!cli) throw new Error("Para setup-para CLI not found; check where @getpara/react-sdk-lite is installed");
await import(pathToFileURL(cli).href);
