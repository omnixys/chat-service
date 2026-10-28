#!/usr/bin/env node
// Git reads credentials from this private pipe, never from argv or remote URLs.
// Semantic Release replaces GIT_ASKPASS; a scoped credential helper stays effective.
if (process.argv[2] !== 'get') process.exit(0);
let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 4096) process.exit(1);
}
const fields = Object.fromEntries(
  input
    .split('\n')
    .filter((line) => line.includes('='))
    .map((line) => {
      const split = line.indexOf('=');
      return [line.slice(0, split), line.slice(split + 1)];
    }),
);
if (
  fields.protocol !== 'https' ||
  fields.host !== 'git.omnixys.com' ||
  !['omnixys/chat-service.git', 'omnixys/chat-service.git/'].includes(fields.path)
)
  process.exit(0);
const username = process.env.FORGEJO_GIT_USERNAME;
const password = process.env.FORGEJO_RELEASE_TOKEN;
if (!username || !password || /[\r\n]/.test(username + password))
  process.exit(1);
process.stdout.write(`username=${username}\npassword=${password}\n\n`);
