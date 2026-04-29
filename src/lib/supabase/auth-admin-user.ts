type AuthAdminUserClient = {
  auth?: {
    admin?: {
      getUserById?: (id: string) => Promise<{
        data?: {
          user?: {
            email?: string | null;
            user_metadata?: { full_name?: string | null; name?: string | null };
          } | null;
        };
        error?: { message?: string };
      }>;
    };
  };
};

export async function getAuthAdminUserSummary(
  client: unknown,
  userId: string
): Promise<{
  email: string | null;
  accountName: string;
  errorMessage?: string;
}> {
  const authAdmin = (client as AuthAdminUserClient).auth?.admin;

  if (!authAdmin?.getUserById) {
    return { email: null, accountName: "there" };
  }

  const { data, error } = await authAdmin.getUserById(userId);
  const user = data?.user;

  return {
    email: user?.email ?? null,
    accountName: user?.user_metadata?.full_name || user?.user_metadata?.name || "there",
    errorMessage: error?.message,
  };
}
