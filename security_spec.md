# THE MACHINE — Firestore Security Specification (Phase 0)

## 1. Data Invariants
1. **Default Deny**: All unspecified Firestore paths deny read and write access (`allow read, write: if false`).
2. **Verified Identity**: Every authenticated read/write requires `request.auth != null && request.auth.token.email_verified == true`.
3. **Strict Owner Isolation (Zero Cross-Tenant Reads/Writes)**: Every path `/users/{userId}/...` requires `request.auth.uid == userId` AND incoming `ownerId == request.auth.uid`.
4. **Master Gate**: Every subcollection document under `/users/{userId}/...` verifies that `/users/{userId}` exists and belongs to `request.auth.uid`.
5. **PII Isolation**: User email is isolated exclusively in `/users/{userId}/private/profile` and never readable by non-owners.
6. **Path ID Hardening**: Document IDs must match `^[a-zA-Z0-9_\\-]+$` and have length `<= 128`.
7. **Schema & Bounds Integrity**: Every field uses `hasAll`/`hasOnly` strict key enforcement on create, `affectedKeys().hasOnly(...)` action-based enforcement on update, immutable `id`/`ownerId`/`createdAt` fields, explicit type + `.size()` caps on every string and array, and `syncedAt == request.time`.
8. **Secure List Queries**: Every `allow list` validates `userId == request.auth.uid && resource.data.ownerId == request.auth.uid` without `get()`/`exists()`.

## 2. The "Dirty Dozen" Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Unauthenticated Read/Write**: Signed-out request reading or writing `/users/uidA/tasks/task_1`.
2. **Cross-Tenant Read**: Signed-in verified `uidB` reading `/users/uidA/notes/note_1`.
3. **Cross-Tenant Write Spoofing**: Signed-in verified `uidB` creating `/users/uidA/tasks/task_1` with `{ ownerId: "uidB" }`.
4. **Owner Field Spoofing Inside Own Space**: Signed-in verified `uidA` creating `/users/uidA/notes/note_1` with `{ ownerId: "uidB" }`.
5. **Unverified Email Bypass**: Signed-in user with `email_verified: false` creating `/users/uidA/private/profile`.
6. **Ghost / Shadow Field Injection**: Owner creating or updating a task with extra undocumented field `{ isAdmin: true }`.
7. **Immutable `createdAt` or `ownerId` Tampering**: Owner updating `/users/uidA` with modified `createdAt` or `notes/note_1` with changed `ownerId`.
8. **Client-Forged `syncedAt` Timestamp**: Owner creating or updating a reminder with a hardcoded past timestamp instead of `request.time` (`serverTimestamp()`).
9. **Path Variable ID Poisoning**: Owner attempting write to `/users/uidA/tasks/../../etc/passwd` or ID > 128 chars.
10. **Payload Size Exhaustion ("Denial of Wallet")**: Owner creating a note with a 200,000-character `content` (limit 50,000) or 100 tags (limit 30).
11. **Unbounded Array / Invalid Element Type**: Owner saving `tags: [12345]` on a task or `firedKeys: [true]` on a reminder.
12. **Blanket List Scraping**: Signed-in user `uidB` executing `list` on `/users/uidA/businessMessages` expecting unfiltered client results.
