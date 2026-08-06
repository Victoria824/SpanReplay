# Auth0/OIDC access control

SpanReplay uses local API-key authentication only when no OIDC issuer/audience is configured. Production mode verifies Auth0 RS256 access tokens against the tenant JWKS and requires both audience and issuer validation.

## Roles

| Role | Permissions |
| --- | --- |
| `viewer` | List and inspect replay evidence within the token tenant |
| `operator` | Viewer permissions, create workflows, run fixture replay and controlled overrides |
| `admin` | Operator permissions and live replay |

Roles are hierarchical. Live replay also requires a written reason of at least eight characters, refuses redacted evidence, and emits a structured audit event with actor subject, roles, tenant, mode, original/replay trace IDs, drift decision, and reason. Tokens and replay content are never written to the audit event.

## Auth0 configuration

Create an API with identifier `https://spanreplay-api`. Add a post-login Action that places approved application roles in the namespaced `https://spanreplay.example.com/roles` access-token claim. For Auth0 Organizations, the standard `org_id` claim is the tenant boundary; tokens without it are rejected by default.

```bash
export AUTH0_ISSUER_BASE_URL='https://YOUR_TENANT.auth0.com/'
export AUTH0_AUDIENCE='https://spanreplay-api'
export AUTH0_ROLES_CLAIM='https://spanreplay.example.com/roles'
export AUTH0_TENANT_CLAIM='org_id'
export AUTH0_REQUIRE_TENANT='true'
```

The gateway overwrites any client-supplied `tenantId` with the verified token tenant. Lists are filtered by tenant and direct access to another tenant's trace ID returns 404 to avoid confirming its existence. AWS access remains independent: the pod obtains short-lived S3 credentials through IRSA, not the end-user token.

## Deployment control

Do not place client secrets in the Console. It should use Authorization Code with PKCE through the organization's approved identity proxy or SPA SDK and send only the access token to the API. Rotate issuer/audience changes through staged deployment, retain local API-key mode only for isolated development, and alert on repeated `authentication.failed` or `authorization.denied` audit events.
