import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
export const registry = 'https://git.omnixys.com/api/packages/omnixys/npm/';
const repoPath = '/repos/omnixys/chat-service';
const base = 'https://git.omnixys.com';
export function releaseTag(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error('Stable release version required');
  return `v${version}`;
}
export function validatePackage(pkg) {
  if (
    pkg.name !== "chat-service" ||
    pkg.private !== true ||
    pkg.repository?.url !== base + '/omnixys/chat-service.git'
  )
    throw new Error('Package/repository/registry contract mismatch');
  releaseTag(pkg.version);
}
export function integrity(bytes) {
  return 'sha512-' + createHash('sha512').update(bytes).digest('base64');
}
export async function api(
  path,
  { token, method = 'GET', body, missing = false, fetcher = fetch } = {},
) {
  if (!token || /[\r\n]/.test(token) || !path.startsWith('/'))
    throw new Error('Protected Forgejo credential required');
  let response;
  try {
    response = await fetcher(base + '/api/v1' + path, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
      headers: {
        Authorization: `token ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('Forgejo HTTPS request failed; details suppressed');
  }
  if (missing && response.status === 404) return null;
  if (!response.ok)
    throw new Error(
      `Forgejo request rejected (HTTP ${response.status}); values suppressed`,
    );
  return response.status === 204 ? {} : response.json();
}
export async function reconcileRelease({
  version,
  commit,
  notes,
  token,
  fetcher,
}) {
  const tag = releaseTag(version);
  if (!/^[0-9a-f]{40}$/.test(commit))
    throw new Error('Exact release commit required');
  const existing = await api(repoPath + '/releases/tags/' + tag, {
    token,
    missing: true,
    fetcher,
  });
  if (existing) {
    const ref = await api(repoPath + '/tags/' + tag, { token, fetcher });
    if (ref.commit?.sha !== commit || existing.draft || existing.prerelease)
      throw new Error(
        'Existing Forgejo release conflicts; no replacement attempted',
      );
    return { name: tag, url: existing.html_url };
  }
  const result = await api(repoPath + '/releases', {
    token,
    method: 'POST',
    fetcher,
    body: {
      tag_name: tag,
      target_commitish: commit,
      name: tag,
      body: notes,
      draft: false,
      prerelease: false,
    },
  });
  return { name: tag, url: result.html_url };
}
export async function verifyConditions(_config, context) {
  const token = context.env.FORGEJO_RELEASE_TOKEN;
  const pkg = JSON.parse(
    await readFile(join(context.cwd, 'package.json'), 'utf8'),
  );
  validatePackage(pkg);
  const repo = await api(repoPath, { token });
  if (repo.full_name !== 'omnixys/chat-service' || !repo.permissions?.push)
    throw new Error('Release identity lacks explicit repository write access');
}
export async function publish(_config, context) {
  return reconcileRelease({
    version: context.nextRelease.version,
    commit: context.nextRelease.gitHead,
    notes: context.nextRelease.notes,
    token: context.env.FORGEJO_RELEASE_TOKEN,
  });
}

export function nextNativeSource(source, version, language) {
  releaseTag(version);
  const patterns = {
    maven: /(<artifactId>address<\/artifactId>\s*<version>)([^<]+)(<\/version>)/,
    gradle: /(^version\s*=\s*)([^\r\n]+)()/m,
    python: /(\[project\][\s\S]*?^version\s*=\s*")([^"\r\n]+)(")/m,
  };
  const pattern = patterns[language];
  if (!pattern || !pattern.test(source)) throw new Error('Declared native version field missing; no mutation');
  return source.replace(pattern, (_match, prefix, _old, suffix) => prefix + version + suffix);
}

export async function prepare(_config, context) {
  const contract = JSON.parse(await readFile(join(context.cwd, 'scripts/forgejo-service-contract.json'), 'utf8'));
  if (contract.repository !== 'chat-service' || contract.manifestName !== "chat-service" || contract.language !== 'typescript') throw new Error('Service release contract conflict');
  const pkgPath = join(context.cwd, 'package.json');
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
  validatePackage(pkg);
  const planned = [];
  for (const relative of contract.profiles) {
    if (!/^node_profiles\/package\.(dev|prod)\.json$/.test(relative)) throw new Error('Unsafe profile path');
    const path = join(context.cwd, relative);
    const value = JSON.parse(await readFile(path, 'utf8'));
    if (value.name !== pkg.name) throw new Error('Service profile identity conflict; no replacement');
    value.version = context.nextRelease.version;
    planned.push({path, source: JSON.stringify(value, null, 2) + '\n'});
  }
  if (contract.language === 'typescript') {
    if (pkg.version !== context.nextRelease.version) throw new Error('Canonical service version must be prepared before profiles');
  } else {
    const expected = {maven:'pom.xml', gradle:'gradle.properties', python:'pyproject.toml'}[contract.language];
    if (contract.versionFile !== expected) throw new Error('Native manifest path conflict');
    const path = join(context.cwd, expected);
    planned.push({path, source: nextNativeSource(await readFile(path, 'utf8'), context.nextRelease.version, contract.language)});
    pkg.version = context.nextRelease.version;
    planned.push({path:pkgPath, source:JSON.stringify(pkg, null, 2) + '\n'});
  }
  for (const {path, source} of planned) if (await readFile(path, 'utf8') !== source) await writeFile(path, source);
}
