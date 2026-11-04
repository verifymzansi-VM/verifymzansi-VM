export function foundationMediaUrl(key: string | null | undefined) {
  if (!key || !/^media\/[a-f0-9-]{36}$/.test(key)) return null;
  return `${(process.env.NEXT_PUBLIC_MEDIA_URL || "https://media.verifymzansi.com").replace(/\/$/, "")}/${key}`;
}
