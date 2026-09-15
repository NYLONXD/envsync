import { beforeAll, describe, expect, test } from "bun:test";

import { testRequest } from "../helpers/request";
import { getDB, seedOrg, type SeedOrgResult } from "../helpers/db";
import { setupUserOrgTuples } from "../helpers/fga";

let orgA: SeedOrgResult;
let orgB: SeedOrgResult;

const masterTuples = {
	is_master: true,
	is_admin: true,
	can_view: true,
	can_edit: true,
	have_api_access: true,
	have_billing_options: true,
	have_webhook_access: true,
};

async function inviteTokenFor(orgId: string, email: string) {
	const db = await getDB();
	const invite = await db
		.selectFrom("invite_user")
		.select("invite_token")
		.where("org_id", "=", orgId)
		.where("email", "=", email)
		.executeTakeFirstOrThrow();
	return invite.invite_token;
}

beforeAll(async () => {
	orgA = await seedOrg({ orgName: "Org A" });
	orgB = await seedOrg({ orgName: "Org B" });
	setupUserOrgTuples(orgA.masterUser.id, orgA.org.id, masterTuples);
	setupUserOrgTuples(orgB.masterUser.id, orgB.org.id, masterTuples);

	const res = await testRequest("/api/certificate/ca/init", {
		method: "POST",
		token: orgB.masterUser.token,
		body: { org_name: orgB.org.name },
	});
	expect([201, 409]).toContain(res.status);
});

describe("user invites for existing accounts", () => {
	test("invites an email that already belongs to another org", async () => {
		const res = await testRequest("/api/onboarding/user", {
			method: "POST",
			token: orgB.masterUser.token,
			body: { email: orgA.masterUser.email, role_id: orgB.roles.developer.id },
		});
		expect(res.status).toBe(201);
	});

	test("rejects inviting an existing member of the same org", async () => {
		const res = await testRequest("/api/onboarding/user", {
			method: "POST",
			token: orgA.masterUser.token,
			body: { email: orgA.masterUser.email, role_id: orgA.roles.developer.id },
		});
		expect(res.status).toBe(409);
		expect((await res.json<{ code: string }>()).code).toBe("ALREADY_A_MEMBER");
	});

	test("GET invite reports account_exists and accept creates a membership on the same identity", async () => {
		const token = await inviteTokenFor(orgB.org.id, orgA.masterUser.email);

		const getRes = await testRequest(`/api/onboarding/user/${token}`);
		expect(getRes.status).toBe(200);
		expect((await getRes.json<{ account_exists: boolean }>()).account_exists).toBe(true);

		const acceptRes = await testRequest(`/api/onboarding/user/${token}/accept`, {
			method: "PUT",
			body: {},
		});
		expect(acceptRes.status).toBe(200);

		const db = await getDB();
		const membership = await db
			.selectFrom("users")
			.selectAll()
			.where("org_id", "=", orgB.org.id)
			.where("email", "=", orgA.masterUser.email)
			.executeTakeFirstOrThrow();
		expect(membership.auth_service_id).toBe(orgA.masterUser.authServiceId);
		expect(membership.role_id).toBe(orgB.roles.developer.id);

		const again = await testRequest("/api/onboarding/user", {
			method: "POST",
			token: orgB.masterUser.token,
			body: { email: orgA.masterUser.email, role_id: orgB.roles.viewer.id },
		});
		expect(again.status).toBe(409);
		expect((await again.json<{ code: string }>()).code).toBe("ALREADY_A_MEMBER");
	});

	test("accepting an invite for someone already in the org just completes it", async () => {
		// Simulates a leftover invite, e.g. a retry after a failed accept.
		const db = await getDB();
		const token = `retry-${Date.now()}`;
		await db
			.insertInto("invite_user")
			.values({
				id: crypto.randomUUID(),
				email: orgB.masterUser.email,
				invite_token: token,
				is_accepted: false,
				org_id: orgB.org.id,
				role_id: orgB.roles.developer.id,
				created_at: new Date(),
				updated_at: new Date(),
			})
			.execute();

		const acceptRes = await testRequest(`/api/onboarding/user/${token}/accept`, {
			method: "PUT",
			body: {},
		});
		expect(acceptRes.status).toBe(200);

		const invite = await db
			.selectFrom("invite_user")
			.select("is_accepted")
			.where("invite_token", "=", token)
			.executeTakeFirstOrThrow();
		expect(invite.is_accepted).toBe(true);

		const memberships = await db
			.selectFrom("users")
			.select("id")
			.where("org_id", "=", orgB.org.id)
			.where("email", "=", orgB.masterUser.email)
			.execute();
		expect(memberships.length).toBe(1);
	});

	test("new-email invite still requires name and password", async () => {
		const email = `new-${Date.now()}@test.local`;
		const createRes = await testRequest("/api/onboarding/user", {
			method: "POST",
			token: orgB.masterUser.token,
			body: { email, role_id: orgB.roles.developer.id },
		});
		expect(createRes.status).toBe(201);
		const token = await inviteTokenFor(orgB.org.id, email);

		const getRes = await testRequest(`/api/onboarding/user/${token}`);
		expect((await getRes.json<{ account_exists: boolean }>()).account_exists).toBe(false);

		const acceptRes = await testRequest(`/api/onboarding/user/${token}/accept`, {
			method: "PUT",
			body: {},
		});
		expect(acceptRes.status).toBe(400);
	});
});
