/** What a failed request said went wrong: the API's `error`, else the status. */
export async function apiError(res: Response): Promise<string> {
  const json: unknown = await res.json().catch(() => null);
  return json !== null && typeof json === 'object' && 'error' in json
    ? String((json as { error: unknown }).error)
    : `HTTP ${res.status}`;
}
