# PR 105 — Invite people who already have an EnvSync account

## The problem

When an admin invited someone who already had an EnvSync account (for example, they were in another organization), the invite failed with:

```json
{"error":"An account already exists for this email.","code":"ACCOUNT_ALREADY_EXISTS"}
```

So there was no way to add one person to a second organization.

## What changed

### 1. Sending an invite
- You can now invite any email, even if that person already has an account somewhere else.
- The only email that gets blocked is one that is **already in this same organization**. It returns `ALREADY_A_MEMBER`.

### 2. Opening the invite link
- The invite details now include `account_exists: true/false`.
- If `account_exists` is `true`, the dashboard and landing pages **hide the name and password fields**. The person just clicks **Join organization**.
- If it is `false`, they see the normal signup form (name + password), same as before.

### 3. Accepting the invite
- **Existing account:** we add them to the new organization using their **same login** (same Keycloak user). Their password does not change. After joining, they sign in with the credentials they already have.
- **New email:** works as before. Name and a strong password are required, and a new account is created.
- **Already in the org** (for example, the first accept half-failed and they clicked again): we don't show an error. We simply mark the invite as accepted. A certificate is issued only if they don't already have one.

### 4. Certificates
- A member certificate is still created when someone joins.
- If the member already has one, we skip it, so the response may not include `generated_certificate_bundle`. It is now optional.

## Files changed

| Area | File | What |
|------|------|------|
| API | `packages/envsync-api/src/services/invite.service.ts` | Only block emails already in this org |
| API | `packages/envsync-api/src/services/user.service.ts` | New `findIdentityByEmail` to find an existing login |
| API | `packages/envsync-api/src/controllers/onboarding.controller.ts` | Accept flow for existing / new / already-member; `account_exists` on GET |
| API | `packages/envsync-api/src/validators/onboarding.validator.ts` | Name/password optional; `account_exists` added; certificate bundle optional |
| SDK | `sdks/envsync-ts-sdk/src/models/*UserInvite*.ts` | Types updated to match the API |
| Web | `apps/envsync-web/src/pages/AcceptUserInvite/index.tsx` | Skip signup form for existing accounts |
| Landing | `apps/envsync-landing/src/pages/AcceptUserInvite.tsx` | Same as web |
| Tests | `packages/envsync-api/tests/mock/user-invite-existing.test.ts` | New tests (below) |

## How to test

Automated:

```bash
cd packages/envsync-api
bun test tests/mock/user-invite-existing.test.ts
```

It checks:
- Inviting an email from another org → **201**
- Inviting someone already in this org → **409 `ALREADY_A_MEMBER`**
- An existing account accepts → joins with the same login, no new password
- Accepting again when already a member → **200**, invite marked accepted, no duplicate membership
- A new email still needs name + password

Manual:
1. Invite an email that already belongs to another org → invite is sent.
2. Open the link → only a **Join organization** button, no form.
3. Click Join, then sign in with the existing email and password → the new org is available.
4. Invite a brand-new email → the link still asks for name and password.

## Notes
- The SDK model files were updated by hand. If you regenerate the SDK, run it against the updated API so these changes are kept.
- Emails are still compared exactly, so `Foo@x.com` and `foo@x.com` count as different people. That is unchanged and could be a follow-up.
