import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../api/queryKeys';
import type { ToolInfo, ToolGroupInfo } from '../types';
import type { ApiClient } from '../api/client';

export function useTools(params: { baseUrl: string; authed: boolean; token: string | null | undefined; client: ApiClient }) {
  const { baseUrl, authed, token, client } = params;

  const toolsQuery = useQuery({
    queryKey: queryKeys.tools(baseUrl, token),
    enabled: authed,
    queryFn: () => client.getTools(),
  });

  const toolGroups: ToolGroupInfo[] = useMemo(() => {
    const grouped = new Map<string, ToolInfo[]>();
    for (const tool of toolsQuery.data ?? []) {
      const entry = grouped.get(tool.serverId) ?? [];
      entry.push(tool);
      grouped.set(tool.serverId, entry);
    }
    return Array.from(grouped.entries())
      .map(([serverId, tools]) => ({
        serverId,
        tools: tools.slice().sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.serverId.localeCompare(b.serverId));
  }, [toolsQuery.data]);

  return { toolsQuery, toolGroups };
}
