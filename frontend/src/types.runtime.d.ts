export {};

declare global {
  interface Window {
    __CHATAPP_CONFIG?: {
      chatApiUrl?: string;
      chatStreaming?: boolean | string;
      keycloak?: {
        enabled?: boolean | string;
        url?: string;
        realm?: string;
        clientId?: string;
        silentCheckSso?: string;
      };
    };
  }
}

