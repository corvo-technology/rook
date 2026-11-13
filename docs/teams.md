# Teams: inviting people into a space

A space can have several people. Every person has one role in it.

## Roles

| Role | Can |
| --- | --- |
| Owner | Everything, including billing, deleting the space and managing other owners |
| Admin | Invite people, approve join requests, change member and admin roles, remove members, manage agents and settings |
| Member | Work in the space |

The backend decides with one helper, `can(membership, permission)` in `packages/core/src/space-roles.ts`.
Admins never act on owners and never grant a role above their own. A space always keeps at least one
owner: the last owner can be neither demoted nor removed, and cannot leave.

## Inviting by email

Owners and admins paste addresses (`Ana <ana@example.com>` works) in Settings, Members. Each address
gets one invitation that:

- works only for that address, and only once the account's address is confirmed (a deployment that
  cannot send email has nobody to confirm, so there the link itself is the proof);
- lasts seven days; sending it again restarts the seven days and keeps the same link;
- carries a token that is an HMAC of the invitation id under the server's auth secret, so nothing
  secret is stored and the link can be copied again.

When the deployment sends email, the invitation goes by email. When it does not, the inviter copies the
link from the invitation row.

An invited person who signs up or signs in joins that space with the invited role instead of getting a
personal space. An invited address may register even where signups are closed or limited by an
allowlist. People who already have an account open the link and press Join.

## Invite link

A space can have one invite link. It only lets people ask to join; an owner or admin approves or denies
each request. Turning the link off ends it; creating another gives a different link. Asking looks the
same whether the link is on, off or unknown, whether the person was denied before, and whether the
space exists, so the link reveals nothing about who belongs. Requests are limited per person and per
space, and the public endpoints are rate limited.

## Leaving and removal

Removing a member (or leaving) deletes their membership. Every request reads the membership, so access
ends at once; live streams re-check it periodically. Their private conversations stay theirs: reads are
scoped to the person, so nobody else gets them. A person with no space left in the organization stops
taking a billing seat; billing seats are synced on join and leave where billing is on.

## Where it lives

- `packages/db/src/team.ts`: membership, invitation and join-request rules (additive tables
  `space_invitations`, `space_invite_links`, `space_join_requests`).
- `apps/api/src/routes/team.ts`: the `spaces.members`, `spaces.invitations`, `spaces.inviteLink` and
  `spaces.joinRequests` procedures.
- `apps/api/src/team-routes.ts`: link-driven HTTP steps (preview, accept, ask to join).
- Web: Settings, Members, and the `/invite/:token` and `/join/:token` pages.

Not yet: mobile management (mobile lists the spaces you belong to), custom roles, and per-person usage.
