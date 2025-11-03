import Keycloak, { type KeycloakInstance } from 'keycloak-js';
import type { KeycloakConfigShape } from './config.js';

export function createKeycloak(config: KeycloakConfigShape): KeycloakInstance {
  return new Keycloak({
    url: config.url,
    realm: config.realm,
    clientId: config.clientId,
  });
}

export type { KeycloakInstance } from 'keycloak-js';

