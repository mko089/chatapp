export const queryKeys = {
  tools: (baseUrl: string, token?: string | null) => ['tools', baseUrl, Boolean(token)] as const,
  health: (baseUrl: string, token?: string | null) => ['health', baseUrl, Boolean(token)] as const,
};

