import { describe, expect, beforeEach, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ToolAccessAdminModal } from './ToolAccessAdminModal';
import type { ToolAccessMatrix } from '../types';

const mockedFetch = vi.fn();

vi.mock('../hooks/useAuthorizedFetch', () => ({
  useAuthorizedFetch: () => mockedFetch,
}));

const sampleMatrix: ToolAccessMatrix = {
  roles: ['manager'],
  groups: [
    {
      group: {
        id: 'employee',
        name: 'Kadromierz',
        description: null,
        sortOrder: 0,
        metadata: null,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
      tools: [
        {
          id: 'employee.employee_list',
          groupId: 'employee',
          name: 'Lista obecności',
          description: null,
          isActive: true,
          metadata: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ],
    },
  ],
  groupPermissions: {
    manager: {},
  },
  toolPermissions: {
    manager: {},
  },
  version: 1716126000,
};

describe('ToolAccessAdminModal', () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    mockedFetch.mockResolvedValue(
      new Response(JSON.stringify({ matrix: sampleMatrix }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  function renderModal() {
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    return render(
      <QueryClientProvider client={client}>
        <ToolAccessAdminModal open baseUrl="http://localhost:4025" onClose={() => {}} />
      </QueryClientProvider>,
    );
  }

  it('allows toggling group permission state and marks pending changes', async () => {
    renderModal();

    const title = await screen.findByText('Konfiguracja dostępu do narzędzi');
    expect(title).toBeTruthy();

    const inheritButton = await screen.findByRole('button', { name: /Dziedziczone/i });
    fireEvent.click(inheritButton);

    const allowButton = await screen.findByRole('button', { name: /Dostęp/i });
    expect(allowButton).toBeTruthy();

    const pendingChip = screen.getByText(/Niezapisane: 1/i);
    expect(pendingChip).toBeTruthy();
  });
});
