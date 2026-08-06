import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";

import { bearerToken, createOidcTokenVerifier, hasRole, principalFromClaims } from "../src/auth/authorizer.js";

afterEach(() => vi.unstubAllEnvs());

describe("OIDC authorization contract", () => {
  it("maps namespaced Auth0 roles and enforces the hierarchy", () => {
    const principal = principalFromClaims(
      {
        sub: "auth0|operator-1",
        org_id: "org_alpha",
        "https://spanreplay.example.com/roles": ["operator", "unknown"],
      },
      "https://spanreplay.example.com/roles",
      "org_id",
    );

    expect(principal).toEqual({ subject: "auth0|operator-1", tenantId: "org_alpha", roles: ["operator"] });
    expect(hasRole(principal, "viewer")).toBe(true);
    expect(hasRole(principal, "operator")).toBe(true);
    expect(hasRole(principal, "admin")).toBe(false);
  });

  it("rejects tokens without the configured tenant boundary", () => {
    expect(() => principalFromClaims(
      { sub: "auth0|user" },
      "https://spanreplay.example.com/roles",
      "org_id",
    )).toThrow("tenant claim");
  });

  it("requires a bearer authorization scheme", () => {
    expect(bearerToken("Bearer signed.jwt.value")).toBe("signed.jwt.value");
    expect(() => bearerToken("Basic abc")).toThrow("Bearer token is required");
  });

  it("verifies RS256 issuer, audience, JWKS, roles, and organization claims", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const publicJwk = { ...await exportJWK(publicKey), kid: "test-key", alg: "RS256", use: "sig" };
    const issuer = "https://tenant.example.auth0.com/";
    const verifier = createOidcTokenVerifier({
      issuer,
      audience: "https://spanreplay-api",
      keyResolver: createLocalJWKSet({ keys: [publicJwk] }),
    });
    const token = await new SignJWT({
      org_id: "org_verified",
      "https://spanreplay.example.com/roles": ["admin"],
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(issuer)
      .setAudience("https://spanreplay-api")
      .setSubject("auth0|verified-user")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

    await expect(verifier(token)).resolves.toEqual({
      subject: "auth0|verified-user",
      tenantId: "org_verified",
      roles: ["admin"],
    });
    const wrongAudience = await new SignJWT({ org_id: "org_verified" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(issuer)
      .setAudience("https://wrong-audience")
      .setSubject("auth0|verified-user")
      .setExpirationTime("5m")
      .sign(privateKey);
    await expect(verifier(wrongAudience)).rejects.toThrow();
  });
});
