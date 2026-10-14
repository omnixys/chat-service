import { mkdtemp, writeFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
const root = process.env.RUNNER_TEMP;
if (!root || !process.env.FORGEJO_ENV || !process.env.NODE_AUTH_TOKEN)
  throw new Error("Runner environment and private package credential required");
const directory = await mkdtemp(join(root, "chat-registry-"));
const path = join(directory, "npmrc");
await writeFile(
  path,
  "@omnixys:registry=https://git.omnixys.com/api/packages/omnixys/npm/\n" +
    "//git.omnixys.com/api/packages/omnixys/npm/:_authToken=${NODE_AUTH_TOKEN}\n",
  { mode: 0o600, flag: "wx" },
);
await appendFile(process.env.FORGEJO_ENV, `NPM_CONFIG_USERCONFIG=${path}\n`);
