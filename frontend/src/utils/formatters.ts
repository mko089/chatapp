import { formatStructuredValue } from './format';

export const formatArgs = (args: unknown): string => formatStructuredValue(args, 0, '{}');
export const formatResult = (result: unknown): string => formatStructuredValue(result ?? null, 2, 'null');

