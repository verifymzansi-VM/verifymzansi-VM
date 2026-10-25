"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import { FoundationAccountBoundary } from "@/components/auth/foundation-account-boundary";
import { z } from "zod";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getFoundationBrowserClient } from "@/lib/foundation/browser-client";
import {
  readFoundationReferenceCatalogue,
  type FoundationReferenceCatalogue,
} from "@/lib/foundation/reference-catalogue";
import { createFoundationPostDraft } from "@/lib/foundation/post-draft";
import { readFoundationListingEditor } from "@/lib/foundation/owner-listing-editor";
import { readFoundationBusinessEventEditor } from "@/lib/foundation/owner-business-event-editor";
import { saveFoundationPostContent } from "@/lib/foundation/post-content";
import { saveFoundationListingTerms } from "@/lib/foundation/owner-listing";
import {
  saveFoundationPostContacts,
  readFoundationPostContacts,
} from "@/lib/foundation/post-contacts";
import { saveFoundationBusinessEventContext } from "@/lib/foundation/business-event-context";
import {
  readFoundationPostingTerms,
  acceptFoundationPostingTerms,
  type FoundationPostingTerms,
} from "@/lib/foundation/posting-terms";
import { submitFoundationPost } from "@/lib/foundation/post-submission";
import { emptyListingPriceForm, type ListingPriceForm } from "@/lib/domains/listings/price-form";
import { listingPriceCategorySchema } from "@/lib/domains/listings/price-terms";
import { ListingPriceFields } from "@/components/posting/listing-price-fields";
import { ensureCsrfTokenReady, withCsrfHeaders } from "@/lib/utils/csrf";

type Kind = "listing" | "business" | "event";
type Area = "market" | "business" | "tourism_events";
type Media = {
  object_id: string;
  purpose: "cover" | "gallery" | "video" | "logo";
  position: number;
  kind: "image" | "video";
};
const inputStyle = "mt-1 w-full rounded-lg border bg-background px-3 py-2.5";
async function fetchEditorState(target: string | undefined, kind: Kind) {
  const api = getFoundationBrowserClient();
  const [catalogue, currentTerms] = await Promise.all([
    readFoundationReferenceCatalogue(api),
    readFoundationPostingTerms(api),
  ]);
  const data = !target
    ? null
    : kind === "listing"
      ? await readFoundationListingEditor(api, { id: target })
      : await readFoundationBusinessEventEditor(api, { id: target });
  if (target && !data) throw new Error("This draft is unavailable or belongs to another account");
  const contact =
    target && data && data.kind !== "business"
      ? await readFoundationPostContacts(api, { id: target })
      : null;
  return { catalogue, currentTerms, data, contact };
}
export function FoundationPostRoute({ kind, area }: { kind: Kind; area: Area }) {
  return (
    <Suspense fallback={<p role="status">Loading your post…</p>}>
      <SelectedPostRoute kind={kind} area={area} />
    </Suspense>
  );
}
function SelectedPostRoute({ kind, area }: { kind: Kind; area: Area }) {
  const params = useParams<{ id?: string }>();
  const query = useSearchParams();
  const initialKind =
    !params.id && area === "tourism_events" && query.get("type") === "tourism_business"
      ? "business"
      : kind;
  return (
    <FoundationAccountBoundary>
      <FoundationPostEditor
        key={`${initialKind}/${params.id ?? "new"}`}
        initialKind={initialKind}
        area={area}
        postId={params.id}
      />
    </FoundationAccountBoundary>
  );
}
function FoundationPostEditor({
  initialKind,
  area,
  postId,
}: {
  initialKind: Kind;
  area: Area;
  postId?: string;
}) {
  const router = useRouter();
  const [reference, setReference] = useState<FoundationReferenceCatalogue>();
  const [terms, setTerms] = useState<FoundationPostingTerms | null>(null);
  const [id, setId] = useState(postId ?? "");
  const [revision, setRevision] = useState(1);
  const [kind, setKind] = useState<Kind>(initialKind);
  const [category, setCategory] = useState("");
  const [activity, setActivity] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [price, setPrice] = useState<ListingPriceForm>(emptyListingPriceForm());
  const [attributes, setAttributes] = useState<Record<string, unknown>>({});
  const [channels, setChannels] = useState<("call" | "whatsapp" | "form")[]>(["form"]);
  const [media, setMedia] = useState<Media[]>([]);
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("draft");
  const [reloadRequired, setReloadRequired] = useState(false);
  const applyEditorState = useCallback(
    ({ catalogue, currentTerms, data, contact }: Awaited<ReturnType<typeof fetchEditorState>>) => {
      setReference(catalogue);
      setTerms(currentTerms);
      if (!data) return;
      setKind(data.kind);
      setCategory(data.category_key);
      setRevision(data.revision);
      setStatus(data.status);
      setTitle(data.content.title ?? "");
      setDescription(data.content.description ?? "");
      setProvince(data.content.province_id ?? "");
      setCity(data.content.city_id ?? "");
      setMedia(
        data.media
          .filter((row) => row.state === "ready")
          .map((row) => ({
            object_id: row.object_id,
            purpose: row.purpose,
            position: row.position,
            kind: row.kind,
          }))
      );
      if (data.kind === "listing") {
        setPrice(data.price_form);
        setAttributes(data.attributes);
      } else {
        setActivity(data.activity_key ?? "");
        if (data.event_window) {
          const local = (value: string) =>
            new Date(Date.parse(value) + 7200000).toISOString().slice(0, 16);
          setStarts(local(data.event_window.starts_at));
          setEnds(local(data.event_window.ends_at));
        }
      }
      if (contact?.channels) setChannels(contact.channels);
      setReloadRequired(false);
    },
    []
  );
  async function load(target = id) {
    applyEditorState(await fetchEditorState(target, initialKind));
  }
  useEffect(() => {
    let active = true;
    void fetchEditorState(postId, initialKind)
      .then((value) => {
        if (active) applyEditorState(value);
      })
      .catch((error) => {
        if (active)
          setMessage(error instanceof Error ? error.message : "The editor could not be loaded");
      });
    return () => {
      active = false;
    };
  }, [postId, initialKind, applyEditorState]);
  const categories =
    reference?.categories.filter((row) => row.area === area && row.kind === kind) ?? [];
  const selected = categories.find((row) => row.key === category);
  const fieldRows = reference?.fields.filter((row) => row.category === category) ?? [];
  const editable = ["draft", "rejected"].includes(status);
  const editPath = (target: string) =>
    `${kind === "listing" ? "/post/edit-listing" : area === "business" ? "/post/edit-business" : "/post/edit-tourism"}/${target}`;
  const eventWindow = () => ({
    starts_at: new Date(`${starts}:00+02:00`).toISOString(),
    ends_at: new Date(`${ends}:00+02:00`).toISOString(),
    timezone: "Africa/Johannesburg",
  });
  async function create() {
    setBusy(true);
    setMessage("");
    try {
      const draft = await createFoundationPostDraft(getFoundationBrowserClient(), {
        context: {
          kind,
          area,
          category_key: category,
          ...(activity ? { activity_key: activity } : {}),
        },
        detail:
          kind === "event"
            ? { ...eventWindow(), contact_channels: channels }
            : kind === "listing"
              ? { contact_channels: channels }
              : {},
      });
      setId(draft.id);
      router.replace(editPath(draft.id));
      await load(draft.id);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The draft could not be created. Check your posts before trying again."
      );
    } finally {
      setBusy(false);
    }
  }
  async function save(submit: boolean) {
    setBusy(true);
    setMessage("");
    let changed = false;
    try {
      const api = getFoundationBrowserClient();
      let rev = revision;
      const content = await saveFoundationPostContent(api, {
        id,
        expected_revision: rev,
        kind,
        content: {
          title,
          description,
          province_id: province || null,
          city_id: city || null,
          locality_label: null,
        },
      });
      rev = content.revision;
      changed = true;
      setRevision(rev);
      if (kind === "listing") {
        const saved = await saveFoundationListingTerms(api, {
          id,
          category,
          expected_revision: rev,
          form: price,
        });
        rev = saved.expected_revision;
        setRevision(rev);
        const result = await api.rpc("save_listing_attributes", {
          p_post_id: id,
          p_expected_revision: rev,
          p_attributes: z.json().parse(attributes),
        });
        if (
          result.error ||
          !result.data ||
          typeof result.data !== "object" ||
          !("revision" in result.data) ||
          typeof result.data.revision !== "number"
        )
          throw new Error("Check the category details; reload the saved draft before trying again");
        rev = result.data.revision;
        setRevision(rev);
      } else if (kind === "event") {
        const saved = await saveFoundationBusinessEventContext(api, {
          id,
          expected_revision: rev,
          patch: { event_window: eventWindow(), activity_key: activity || null },
        });
        rev = saved.revision;
        setRevision(rev);
      }
      const attached = await api.rpc("set_post_media", {
        p_post_id: id,
        p_expected_revision: rev,
        p_items: media.map(({ object_id, purpose, position }) => ({
          object_id,
          purpose,
          position,
        })),
      });
      if (
        attached.error ||
        !attached.data ||
        typeof attached.data !== "object" ||
        !("revision" in attached.data) ||
        typeof attached.data.revision !== "number"
      )
        throw new Error("Photos or videos could not be attached; reload the saved draft");
      rev = attached.data.revision;
      setRevision(rev);
      if (kind !== "business") {
        const saved = await saveFoundationPostContacts(api, {
          id,
          expected_revision: rev,
          channels,
        });
        rev = saved.revision;
        setRevision(rev);
      }
      if (submit) {
        if (!accepted || !terms)
          throw new Error("Read and accept the posting terms before submitting");
        await acceptFoundationPostingTerms(api, {
          version: terms.version,
          document_hash: terms.document_hash,
          accepted: true,
        });
        const result = await submitFoundationPost(api, { id, expected_revision: rev });
        setRevision(result.revision);
        setStatus(result.status);
        setMessage("Your post is saved and waiting for review.");
      } else setMessage("Draft saved.");
    } catch (error) {
      if (changed) setReloadRequired(true);
      setMessage(
        error instanceof Error
          ? error.message
          : "The save could not be confirmed. Reload your draft before trying again."
      );
    } finally {
      setBusy(false);
    }
  }
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setMessage("");
    try {
      await ensureCsrfTokenReady();
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.set("files", file);
        const response = await fetch("/api/media/upload", {
          method: "POST",
          headers: withCsrfHeaders(),
          body: form,
        });
        const data = await response.json();
        if (!response.ok || !Array.isArray(data.objects))
          throw new Error(
            "A file could not be uploaded. Check its format and your storage allowance."
          );
        for (const item of data.objects) {
          if (
            typeof item.object_id !== "string" ||
            !/^[a-f0-9-]{36}$/i.test(item.object_id) ||
            !["image", "video"].includes(item.kind)
          )
            throw new Error("Upload acknowledgement was invalid");
          setMedia((current) => [
            ...current,
            {
              object_id: item.object_id,
              kind: item.kind,
              purpose:
                item.kind === "video"
                  ? "video"
                  : current.some((row) => row.purpose === "cover")
                    ? "gallery"
                    : "cover",
              position: current.filter((row) => row.kind === item.kind).length,
            },
          ]);
        }
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload could not be completed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="container-page max-w-4xl space-y-6 py-8">
      <header>
        <Link href="/dashboard/listings" className="text-sm text-primary">
          Back to your posts
        </Link>
        <h1 className="mt-3 font-display text-3xl font-bold">
          {id ? "Edit your post" : "Create a post"}
        </h1>
        <p className="mt-2 text-muted-foreground">
          Save a draft, add your details and submit it for review. Identity, phone and location
          verification are required to publish.
        </p>
      </header>
      {message && (
        <p role="status" className="rounded-xl border bg-card p-4">
          {message}
        </p>
      )}
      {reloadRequired && (
        <button
          className="rounded-lg border p-3"
          onClick={() =>
            void load().catch(() => setMessage("The saved draft could not be reloaded"))
          }
        >
          Reload saved draft
        </button>
      )}
      {!reference ? (
        <p>Loading editor…</p>
      ) : !id ? (
        <form
          className="space-y-5 rounded-2xl border bg-card p-6"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          {area === "tourism_events" && (
            <label className="block">
              Post type
              <select
                className={inputStyle}
                value={kind}
                onChange={(event) => {
                  setKind(event.target.value as Kind);
                  setCategory("");
                  setActivity("");
                }}
              >
                <option value="event">Event</option>
                <option value="business">Tourism business</option>
              </select>
            </label>
          )}
          <label className="block">
            Category
            <select
              required
              className={inputStyle}
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
                setActivity("");
              }}
            >
              <option value="">Choose a category</option>
              {categories.map((row) => (
                <option key={row.key} value={row.key}>
                  {row.label}
                </option>
              ))}
            </select>
          </label>
          {selected?.activity_required && (
            <label className="block">
              Activity
              <select
                required
                className={inputStyle}
                value={activity}
                onChange={(event) => setActivity(event.target.value)}
              >
                <option value="">Choose an activity</option>
                {reference.activities
                  .filter((row) => row.category === category)
                  .map((row) => (
                    <option key={row.key} value={row.key}>
                      {row.label}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {kind === "event" && (
            <EventInputs starts={starts} ends={ends} setStarts={setStarts} setEnds={setEnds} />
          )}
          <button
            disabled={busy || !category}
            className="rounded-lg bg-primary p-3 font-semibold text-primary-foreground"
          >
            {busy ? "Creating…" : "Create draft"}
          </button>
        </form>
      ) : !editable ? (
        <section className="space-y-4 rounded-2xl border bg-card p-6">
          <p>Post status: {status.replaceAll("_", " ")}</p>
          <p>Live posts keep their published version while an edit is reviewed.</p>
          <button
            className="rounded-lg border p-3"
            disabled={busy || !["live", "paused", "expired"].includes(status)}
            onClick={async () => {
              setBusy(true);
              try {
                const result = await getFoundationBrowserClient().rpc("create_post_edit", {
                  p_post_id: id,
                  p_expected_revision: revision,
                });
                if (
                  result.error ||
                  !result.data ||
                  typeof result.data !== "object" ||
                  !("id" in result.data) ||
                  typeof result.data.id !== "string"
                )
                  throw new Error();
                router.push(editPath(result.data.id));
              } catch {
                setMessage("An edit could not be started; refresh the post and try again");
              } finally {
                setBusy(false);
              }
            }}
          >
            Start an edit
          </button>
        </section>
      ) : (
        <form
          className="space-y-6 rounded-2xl border bg-card p-6"
          onSubmit={(event) => {
            event.preventDefault();
            void save(false);
          }}
        >
          <label className="block">
            Title
            <input
              required
              maxLength={100}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className={inputStyle}
            />
          </label>
          <label className="block">
            Description
            <textarea
              required
              maxLength={kind === "business" ? 3000 : 5000}
              rows={6}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className={inputStyle}
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label>
              Province
              <select
                required
                className={inputStyle}
                value={province}
                onChange={(event) => {
                  setProvince(event.target.value);
                  setCity("");
                }}
              >
                <option value="">Choose province</option>
                {reference.provinces.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              City or town
              <select
                required
                className={inputStyle}
                value={city}
                onChange={(event) => setCity(event.target.value)}
              >
                <option value="">Choose city</option>
                {reference.cities
                  .filter((row) => row.province === province)
                  .map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.label}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          {kind === "listing" && (
            <ListingPriceFields
              category={listingPriceCategorySchema.parse(category)}
              value={price}
              onChange={setPrice}
              disabled={busy}
            />
          )}
          {kind === "listing" &&
            fieldRows.map((field) => {
              const value = attributes[field.key];
              const set = (next: unknown) =>
                setAttributes((current) => ({ ...current, [field.key]: next }));
              const options =
                field.options?.map((option) =>
                  typeof option === "string" ? { value: option, label: option } : option
                ) ?? [];
              return (
                <label key={field.key} className="block">
                  {field.label}
                  {field.required ? " *" : ""}
                  {field.renderer === "boolean" ? (
                    <input
                      type="checkbox"
                      className="ml-3"
                      checked={value === true}
                      onChange={(event) => set(event.target.checked)}
                    />
                  ) : field.renderer === "checklist" ? (
                    <select
                      multiple
                      className={inputStyle}
                      value={
                        Array.isArray(value)
                          ? value.filter((item): item is string => typeof item === "string")
                          : []
                      }
                      onChange={(event) =>
                        set(Array.from(event.target.selectedOptions).map((option) => option.value))
                      }
                    >
                      {options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : field.renderer === "select" ? (
                    <select
                      className={inputStyle}
                      required={field.required}
                      value={typeof value === "string" ? value : ""}
                      onChange={(event) => set(event.target.value)}
                    >
                      <option value="">Choose an option</option>
                      {options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className={inputStyle}
                      required={field.required}
                      maxLength={200}
                      type={
                        field.renderer === "number" || field.renderer === "money"
                          ? "number"
                          : "text"
                      }
                      value={typeof value === "string" || typeof value === "number" ? value : ""}
                      onChange={(event) =>
                        set(
                          field.renderer === "number" || field.renderer === "money"
                            ? event.target.value === ""
                              ? null
                              : Number(event.target.value)
                            : event.target.value
                        )
                      }
                    />
                  )}
                </label>
              );
            })}
          {kind === "event" && (
            <EventInputs starts={starts} ends={ends} setStarts={setStarts} setEnds={setEnds} />
          )}
          <label className="block">
            Photos and videos
            <input
              className={inputStyle}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
              disabled={busy}
              onChange={(event) => void upload(event.target.files)}
            />
          </label>
          <div className="space-y-2">
            {media.map((item, index) => (
              <div
                key={item.object_id}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <span>
                  {item.kind === "video"
                    ? "Video"
                    : item.purpose === "cover"
                      ? "Cover photo"
                      : "Photo"}{" "}
                  {index + 1}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    setMedia((current) =>
                      current
                        .filter((row) => row.object_id !== item.object_id)
                        .map((row, position) => ({ ...row, position }))
                    )
                  }
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          {kind !== "business" && (
            <fieldset>
              <legend>Contact options</legend>
              <div className="mt-2 flex flex-wrap gap-5">
                {(["form", "call", "whatsapp"] as const).map((channel) => (
                  <label key={channel} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={channels.includes(channel)}
                      onChange={(event) =>
                        setChannels((current) =>
                          event.target.checked
                            ? [...current, channel]
                            : current.filter((item) => item !== channel)
                        )
                      }
                    />
                    {channel === "form" ? "Enquiry form" : channel === "call" ? "Call" : "WhatsApp"}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {terms && (
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(event) => setAccepted(event.target.checked)}
              />
              <span>
                I accept the{" "}
                <Link href={terms.document_path} target="_blank" className="underline">
                  posting terms
                </Link>
                .
              </span>
            </label>
          )}
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={busy || reloadRequired}
              className="rounded-lg border p-3"
            >
              Save draft
            </button>
            <button
              type="button"
              disabled={busy || reloadRequired || !accepted}
              className="rounded-lg bg-primary p-3 font-semibold text-primary-foreground disabled:opacity-50"
              onClick={() => void save(true)}
            >
              Submit for review
            </button>
            <Link className="p-3 text-primary underline" href="/verification">
              Verification
            </Link>
          </div>
        </form>
      )}
    </main>
  );
}
function EventInputs({
  starts,
  ends,
  setStarts,
  setEnds,
}: {
  starts: string;
  ends: string;
  setStarts: (value: string) => void;
  setEnds: (value: string) => void;
}) {
  return (
    <fieldset className="grid gap-4 sm:grid-cols-2">
      <legend className="mb-2">Event times — South African time</legend>
      <label>
        Starts
        <input
          required
          type="datetime-local"
          className={inputStyle}
          value={starts}
          onChange={(event) => setStarts(event.target.value)}
        />
      </label>
      <label>
        Ends
        <input
          required
          type="datetime-local"
          className={inputStyle}
          value={ends}
          onChange={(event) => setEnds(event.target.value)}
        />
      </label>
    </fieldset>
  );
}
