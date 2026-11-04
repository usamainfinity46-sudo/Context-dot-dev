export const human = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch("/api" + path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const data = await response
      .json()
      .catch(() => ({ error: "Server is unavailable" }));
    throw new Error(data.error || "Request failed");
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
export const fileUrl = (id: string, file: string) =>
  `/api/jobs/${id}/files/${file}`;
