begin;

drop policy if exists "Public reads avatars" on storage.objects;
drop policy if exists "Users read own avatar metadata" on storage.objects;

create policy "Users read own avatar metadata"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

commit;