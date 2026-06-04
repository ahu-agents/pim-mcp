# Security Policy

## Supported Versions
The `main` branch and the latest published package versions are the actively supported lines.

## Reporting a Vulnerability
Please do not open public issues for security vulnerabilities.

Report privately to the maintainer and include:
- affected package or tool
- impact and attack scenario
- reproduction steps
- suggested mitigation if available

You will receive an acknowledgement as soon as possible, and we will coordinate remediation and disclosure timing.

## Hardening Notes
- Credentials (IMAP/SMTP/CalDAV/CardDAV) are passed via environment variables; never commit them or paste them into issues or logs.
- Use app-specific passwords where the provider supports them.
- `SMTP_ALLOWED_FROM` controls the visible From allowlist; review it before deployment.
- Keep dependencies up to date.
