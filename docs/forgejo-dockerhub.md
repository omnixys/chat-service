# Automatic service releases

`service-ci.yml` runs on main and same-repository pull requests using
`linux-amd64`. Fork PRs receive no private-package credentials. All existing
checks remain required; failures prevent release admission.

Trusted `omnixys/release-control` selects an exact protected main SHA with
successful service-ci.yml/validate. Conventional commits determine patch
(`fix`), minor (`feat`) and major (`breaking` or breaking footer). It prepares
version files and CHANGELOG, then builds the immutable candidate using a
separate restricted rootless builder. No host Docker socket or cluster token.

Docker Hub destination: `docker.io/omnixys/chat-service`.
Required platforms: linux/amd64, linux/arm64.
Only accepted images receive the semantic version and `latest` tags. Resumes
reuse the same candidate and digests; conflicts stop without replacement.
No application deployment is part of this pipeline. Existing manual Forgejo
OCI workflows remain for compatibility, not as automatic release owners.

A missing native builder, publisher credential, successful CI or required
platform keeps publication blocked. Workflow installation is not image proof.
