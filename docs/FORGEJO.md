# chat: Forgejo source and Actions

Canonical repository: https://git.omnixys.com/omnixys/chat-service

The current implementation, published Omnixys dependencies and original Git
history are migrated as Caleb. GitHub is retained as a return remote when present.
No original GitHub repository, cluster, application data or deployment is changed.

Forgejo Actions are manually dispatched. CI and the guarded SemVer release reuse
the verified package/media toolchains with pinned versions and checksums. Service
releases create source tags/changelog/manifest updates, not npm/PyPI/Maven packages.
Legacy release configuration is retained; the programmatic Forgejo invocation
explicitly supplies its own provider configuration and never receives GitHub auth.

Validation errors are intentionally not fixed during this source-migration pass.
A failed or unexecuted job is NOT a successful acceptance. Release credentials
are restricted to this repository and exposed only after verification. Private
dependency resolution uses a read-only package credential. No Docker socket,
privileged job, kubeconfig or production deployment is provided.

Container integration/E2E, OCI publishing and runtime deployment remain separate
gates. Existing GitHub workflows remain archived, not active Forgejo workflows.
No image digest or runtime readiness is claimed by source migration alone.
