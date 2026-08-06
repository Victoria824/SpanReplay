import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";

export const platformRoles = ["viewer", "operator", "admin"] as const;
export type PlatformRole = typeof platformRoles[number];

export type AuthenticatedPrincipal = {
  subject: string;
  tenantId: string;
  roles: PlatformRole[];
};

export type TokenVerifier = (token: string) => Promise<AuthenticatedPrincipal>;

export type OidcTokenVerifierOptions = {
  issuer: string;
  audience: string;
  keyResolver: JWTVerifyGetKey;
  rolesClaim?: string;
  tenantClaim?: string;
  requireTenant?: boolean;
};

const roleLevel: Record<PlatformRole, number> = { viewer: 1, operator: 2, admin: 3 };

export function hasRole(principal: AuthenticatedPrincipal, required: PlatformRole): boolean {
  return principal.roles.some((role) => roleLevel[role] >= roleLevel[required]);
}

function stringValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return typeof value === "string" ? value.split(" ").filter(Boolean) : [];
}

export function principalFromClaims(
  payload: JWTPayload,
  rolesClaim: string,
  tenantClaim: string,
  requireTenant = true,
): AuthenticatedPrincipal {
  if (!payload.sub) throw new Error("OIDC token has no subject");
  const tenant = payload[tenantClaim] ?? payload.org_id;
  if (requireTenant && (typeof tenant !== "string" || tenant.length === 0)) {
    throw new Error(`OIDC token has no ${tenantClaim} tenant claim`);
  }
  const roles = stringValues(payload[rolesClaim])
    .filter((role): role is PlatformRole => platformRoles.includes(role as PlatformRole));
  return {
    subject: payload.sub,
    tenantId: typeof tenant === "string" && tenant.length > 0 ? tenant : "default",
    roles: roles.length > 0 ? [...new Set(roles)] : ["viewer"],
  };
}

export function createOidcTokenVerifierFromEnv(): TokenVerifier | null {
  const issuer = process.env.AUTH0_ISSUER_BASE_URL;
  const audience = process.env.AUTH0_AUDIENCE;
  if (!issuer && !audience) return null;
  if (!issuer || !audience) throw new Error("AUTH0_ISSUER_BASE_URL and AUTH0_AUDIENCE must be configured together");
  const normalizedIssuer = issuer.endsWith("/") ? issuer : `${issuer}/`;
  return createOidcTokenVerifier({
    issuer: normalizedIssuer,
    audience,
    keyResolver: createRemoteJWKSet(new URL(".well-known/jwks.json", normalizedIssuer)),
    rolesClaim: process.env.AUTH0_ROLES_CLAIM,
    tenantClaim: process.env.AUTH0_TENANT_CLAIM,
    requireTenant: process.env.AUTH0_REQUIRE_TENANT !== "false",
  });
}

export function createOidcTokenVerifier(options: OidcTokenVerifierOptions): TokenVerifier {
  const rolesClaim = options.rolesClaim ?? "https://spanreplay.example.com/roles";
  const tenantClaim = options.tenantClaim ?? "org_id";
  return async (token) => {
    const { payload } = await jwtVerify(token, options.keyResolver, {
      issuer: options.issuer,
      audience: options.audience,
      algorithms: ["RS256"],
    });
    return principalFromClaims(payload, rolesClaim, tenantClaim, options.requireTenant ?? true);
  };
}

export function bearerToken(authorization: string | undefined): string {
  const value = authorization ?? "";
  if (value.slice(0, 6).toLowerCase() !== "bearer" || value.charCodeAt(6) !== 0x20) {
    throw new Error("Bearer token is required");
  }

  let tokenStart = 7;
  while (value.charCodeAt(tokenStart) === 0x20) tokenStart += 1;
  const token = value.slice(tokenStart);
  if (!token) throw new Error("Bearer token is required");
  for (const character of token) {
    const code = character.charCodeAt(0);
    if (code <= 0x20 || code === 0x7f) throw new Error("Bearer token is required");
  }
  return token;
}
