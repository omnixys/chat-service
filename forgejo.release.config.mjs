// Continue the original SemVer lineage on Forgejo without resetting history.
export default {
  branches: ['main'],
  repositoryUrl: 'https://git.omnixys.com/omnixys/chat-service.git',
  tagFormat: 'v${version}',
  plugins: [
    [
      '@semantic-release/commit-analyzer',
      {
        preset: 'conventionalcommits',
        releaseRules: [
          { breaking: true, release: 'major' },
          { type: 'breaking', release: 'major' },
          { type: 'feat', release: 'minor' },
          { type: 'fix', release: 'patch' },
          { type: 'perf', release: 'patch' },
          { type: 'refactor', release: 'patch' },
        ],
      },
    ],
    [
      '@semantic-release/release-notes-generator',
      {
        preset: 'conventionalcommits',
        host: 'https://git.omnixys.com',
        linkCompare: true,
        linkReferences: false,
        presetConfig: {
          types: [
            { type: 'breaking', section: 'Breaking changes' },
            { type: 'feat', section: 'Features' },
            { type: 'fix', section: 'Fixes' },
            { type: 'refactor', section: 'Refactoring' },
          ],
        },
      },
    ],
    ['@semantic-release/changelog', { changelogFile: 'CHANGELOG.md' }],
    ['@semantic-release/npm', { npmPublish: false }],
    './scripts/forgejo-service-release.mjs',
    [
      '@semantic-release/git',
      {
        assets: ["package.json","pnpm-lock.yaml","CHANGELOG.md"],
        message:
          'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
      },
    ],
  ],
};
