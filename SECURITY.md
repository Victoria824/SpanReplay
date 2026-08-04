# Security policy

## Reporting

Please do not open a public issue for suspected vulnerabilities. Send a private report through GitHub's repository security advisory feature and include affected versions, impact, a minimal reproduction, and suggested mitigation if known.

## Supported versions

The latest tagged minor release receives security fixes. This pre-1.0 project may change replay schemas between minor versions; migrations will be documented in release notes.

## Security boundaries

- SpanReplay redacts secret-like values and raw workflow content by default.
- Fixture replay is intended for sanitized deterministic evidence, not arbitrary production payload capture.
- Live replay is rejected when request content was not retained.
- Replay IDs are strict 32-character hexadecimal trace IDs; file paths are never accepted from API input.
- Containers run as non-root and Kubernetes manifests disable privilege escalation and service-account token mounting.
- The local Vector configuration mounts the Docker socket read-only. Treat that as a trusted developer-machine convenience, not a hardened multi-tenant pattern.
- Authentication, tenant isolation, encryption key management, retention policies, legal review, and data residency remain deployment responsibilities.

Never commit `.env`, Datadog keys, provider credentials, raw customer prompts, or exported production traces.

