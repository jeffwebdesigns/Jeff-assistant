/**
 * Adversarial "Dirty Dozen" Firestore Security Rules Verification Specification.
 * Intended for validation with @firebase/rules-unit-testing against Firestore Emulator.
 * All 12 adversarial cases below MUST resolve with PERMISSION_DENIED.
 */

export interface SecurityTestCase {
  id: number;
  name: string;
  collectionPath: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  expectedOutcome: 'PERMISSION_DENIED';
  rationale: string;
}

export const DIRTY_DOZEN_TESTS: SecurityTestCase[] = [
  {
    id: 1,
    name: 'Unauthenticated read blocked',
    collectionPath: 'users/userA/tasks/task_1',
    operation: 'get',
    expectedOutcome: 'PERMISSION_DENIED',
    rationale: 'Default-deny and isVerifiedUser() reject null request.auth.',
  },
  {
    id: 2,
    name: 'Cross-tenant read blocked',
    collectionPath: 'users/userA/notes/note_1',
    operation: 'get',
    expectedOutcome: 'PERMISSION_DENIED',
    rationale: 'isOwnerVerified(userId) enforces request.auth.uid == userId.',
  },
  {
    id: 3,
    name: 'Cross-tenant write blocked',
    collectionPath: 'users/userA/tasks/task_1',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    rationale: 'userId != request.auth.uid and ownerId != request.auth.uid both fail.',
  },
  {
    id: 4,
    name: 'OwnerId spoofing inside own workspace blocked',
    collectionPath: 'users/userA/notes/note_1',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    rationale: 'isValidNote checks data.ownerId == request.auth.uid.',
  },
  {
    id: 5,
    name: 'Unverified email blocked on PII profile',
    collectionPath: 'users/userA/private/profile',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    rationale: 'isVerifiedUser() enforces request.auth.token.email_verified == true.',
  },
  {
    id: 6,
    name: 'Shadow field injection blocked',
    collectionPath: 'users/userA/tasks/task_1',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    rationale: 'keys().hasOnly(...) rejects unknown keys like isAdmin.',
  },
  {
    id: 7,
    name: 'Immutable createdAt / ownerId tampering blocked',
    collectionPath: 'users/userA/notes/note_1',
    operation: 'update',
    expectedOutcome: 'PERMISSION_DENIED',
    rationale: 'Update branches check affectedKeys().hasOnly([...]) and immutable fields.',
  },
  {
    id: 8,
    name: 'Client-forged syncedAt timestamp blocked',
    collectionPath: 'users/userA/reminders/rem_1',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    rationale: 'Temporal integrity mandates incoming().syncedAt == request.time.',
  },
  {
    id: 9,
    name: 'Invalid document ID blocked',
    collectionPath: 'users/userA/tasks/bad$id%20name',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    rationale: 'isValidId enforces ^[a-zA-Z0-9_\\-]+$ and <= 128 chars.',
  },
  {
    id: 10,
    name: 'Oversized string payload blocked',
    collectionPath: 'users/userA/notes/note_1',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    rationale: 'content.size() <= 50000 prevents resource exhaustion.',
  },
  {
    id: 11,
    name: 'Invalid list element type blocked',
    collectionPath: 'users/userA/tasks/task_1',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    rationale: 'isStringArray validates first element type and array bounds.',
  },
  {
    id: 12,
    name: 'Cross-tenant list scraping blocked',
    collectionPath: 'users/userA/businessMessages',
    operation: 'list',
    expectedOutcome: 'PERMISSION_DENIED',
    rationale: 'allow list requires userId == request.auth.uid && resource.data.ownerId == request.auth.uid.',
  },
];
