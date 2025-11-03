import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { isSuperAdmin } from '../src/rbac/guards.js';
import { config } from '../src/config.js';

const originalAdminUsers = [...config.rbac.adminUsers];
const originalOwnerUsers = [...config.rbac.ownerUsers];

function resetRbacConfig() {
  config.rbac.adminUsers.splice(0, config.rbac.adminUsers.length, ...originalAdminUsers);
  config.rbac.ownerUsers.splice(0, config.rbac.ownerUsers.length, ...originalOwnerUsers);
}

beforeEach(() => {
  resetRbacConfig();
});

afterEach(() => {
  resetRbacConfig();
});

test('rozpoznaje superadmina na podstawie listy adminUsers', () => {
  config.rbac.adminUsers.splice(0, config.rbac.adminUsers.length, 'root-user');
  assert.equal(isSuperAdmin({ username: 'root-user' }), true);
});

test('rozpoznaje superadmina na podstawie listy ownerUsers', () => {
  config.rbac.ownerUsers.splice(0, config.rbac.ownerUsers.length, 'owner');
  assert.equal(isSuperAdmin({ email: 'OWNER' }), true);
});

test('odrzuca użytkownika bez uprawnień administratorskich', () => {
  config.rbac.adminUsers.length = 0;
  config.rbac.ownerUsers.length = 0;
  assert.equal(isSuperAdmin({ username: 'regular', roles: ['viewer'] }), false);
});
