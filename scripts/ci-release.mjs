import semanticRelease from 'semantic-release';
import config from '../forgejo.release.config.mjs';
if (!process.env.FORGEJO_RELEASE_TOKEN || process.env.FORGEJO_GIT_USERNAME !== 'caleb') throw new Error('Protected Caleb repository release identity required');
for (const name of ['GH_TOKEN','GITHUB_TOKEN','GL_TOKEN','GITLAB_TOKEN','GIT_CREDENTIALS']) delete process.env[name];
await semanticRelease(config, {cwd:process.cwd(),env:process.env});
