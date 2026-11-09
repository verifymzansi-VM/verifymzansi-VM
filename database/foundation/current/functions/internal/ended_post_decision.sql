-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.ended_post_decision(p_post private.posts)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare ext private.post_deletion_extensions; window_end timestamptz; paid record; started record;
begin
  if p_post.status not in('expired','sold','archived') then return null; end if;
  -- Only an expired Market or Business post waits for a plan payment.
  if p_post.kind='event' or p_post.status<>'expired' then
    return case when p_post.deletes_at<=clock_timestamp() then jsonb_build_object('action','delete') end;
  end if;
  select * into ext from private.post_deletion_extensions x where x.post_id=p_post.id and x.ended_at=p_post.ended_at;
  -- Plan payments count when started from 24 hours before the post expired
  -- until its deletion date, the 24-hour extension included.
  window_end:=coalesce(ext.grace_ended_at+interval '24 hours',p_post.deletes_at);
  -- One has been confirmed: the post is kept until 3 days after that payment.
  select pay.id,pay.completed_at into paid from private.payments pay
    where pay.owner_id=p_post.owner_id and pay.product_kind='plan' and pay.status='complete'
      and pay.fulfillment_status='fulfilled' and pay.created_at>=p_post.ended_at-interval '24 hours'
      and pay.created_at<=window_end
    order by pay.completed_at desc,pay.id limit 1;
  if paid.completed_at+interval '3 days'>p_post.deletes_at then
    return jsonb_build_object('action','keep','payment_id',paid.id,
      'grace_ended_at',coalesce(ext.grace_ended_at,p_post.deletes_at),'deletes_at',paid.completed_at+interval '3 days');
  end if;
  if p_post.deletes_at>clock_timestamp() then return null; end if;
  -- Due: one 24-hour extension while such a payment is still being confirmed
  -- (a confirmed payment still being reconciled counts). The extension is
  -- always waited out; after it the post goes.
  if ext.post_id is null then
    select pay.id into started from private.payments pay
      where pay.owner_id=p_post.owner_id and pay.product_kind='plan'
        and pay.created_at>=p_post.ended_at-interval '24 hours' and pay.created_at<=p_post.deletes_at
        and (pay.status='pending' or (pay.status='complete' and pay.fulfillment_status='needs_reconciliation'))
      order by pay.created_at desc,pay.id limit 1;
    if started.id is not null then
      return jsonb_build_object('action','extend','payment_id',started.id,'grace_ended_at',p_post.deletes_at,
        'deletes_at',p_post.deletes_at+interval '24 hours');
    end if;
  end if;
  return jsonb_build_object('action','delete');
end$function$;
alter function internal.ended_post_decision(private.posts) owner to postgres;
revoke all on function internal.ended_post_decision(private.posts) from public;
