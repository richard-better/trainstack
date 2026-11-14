export const exportUrl = (serverUrl: string) => `${serverUrl}/account/export`;

export type Deletion = "deleted" | "sign_in_again" | "failed";

type DeleteUser = () => Promise<{ error: { code?: string; status?: number } | null }>;

export async function deleteAccount(deleteUser: DeleteUser): Promise<Deletion> {
  try {
    const { error } = await deleteUser();
    if (!error) return "deleted";
    return error.code === "SESSION_EXPIRED" ? "sign_in_again" : "failed";
  } catch {
    return "failed";
  }
}
