"use client";
import { PostSelect } from "@/components/post/post-select";

import { settleMediaUploads } from "@/app/post/_lib/settle-media-uploads";
import { ListingQualityHint } from "@/components/post/listing-quality-hint";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePostTransport } from "@/hooks/use-post-transport";
import Link from "next/link";
import { Camera, Eye, FileText, Loader2, Tag } from "lucide-react";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import { usePostActionFields } from "@/hooks/use-post-action-fields";
import { loadOwnListing } from "@/app/post/edit-listing/[id]/load-own-listing";
import { listingCopyFields, parseCopyId, submitListingCopy } from "./listing-copy";
import { CopyFinalCheck, CopyNotice, CopyVideoNote } from "./copy-notes";
import { SHOW_POST_COPY } from "@/lib/hidden-features";
import { Input } from "@/components/ui/input";
import { PostLabel as Label } from "@/components/post/post-label";
import { Textarea } from "@/components/ui/textarea";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { usePostDraftAutosave } from "@/hooks/use-post-draft-autosave";
import { CategoryPicker } from "@/components/listings/category-picker";
import { MediaUpload } from "@/components/ui/media-upload";
import { VideoFrameSelector } from "@/components/ui/video-frame-selector";
import {
  PHOTO_OR_VIDEO_RULE,
  VIDEO_COVER_NEEDED,
  photosWithVideoCover,
} from "@/lib/forms/video-cover-photo";
import { MediaCropPreview, type CropPosition } from "@/components/ui/media-crop-preview";
import {
  UploadProgressPanel,
  useUploadProgress,
  type UploadSlotStatus,
} from "@/components/ui/upload-progress-panel";
import {
  PlanGate,
  usePlanMaxPhotos,
  usePlanMaxVideos,
  usePlanVideoAllowed,
} from "@/components/billing/plan-gate";
import { LocationSelector, type LocationValue } from "@/components/ui/location-selector";
import type { ListingCategory, ListingCondition } from "@/types/enums";
import { mapListingCategory } from "@/lib/utils/enum-compat";
import { cn } from "@/lib/utils";
import { ListingCard } from "@/components/listings/listing-card";
import { PhotoOrderList } from "@/components/post/photo-order-list";
import {
  PostDraftStatus,
  PostFormFooter,
  PostFormScaffold,
  PostFormSection,
  type PostFormStep,
} from "@/components/post/post-form-scaffold";
import {
  normalizeCreatePostError,
  normalizeCreatePostRuntimeError,
} from "@/app/post/_lib/create-post-errors";
import {
  POST_SESSION_EXPIRED_MESSAGE,
  resolveServerRedirect,
} from "@/app/post/_lib/post-submit-navigation";
import { PostSignInAction } from "@/components/post/post-sign-in-action";
import { PostingTermsConsent } from "@/components/post/posting-terms-consent";
import {
  getListingMediaUploadErrorState,
  uploadListingImages,
  uploadListingVideoFiles,
} from "@/app/post/_lib/listing-media-upload";
import { prewarmVideosForFastUpload } from "@/app/post/_lib/video-fast-upload";
import {
  DEFAULT_LISTING_CONTACT_METHODS,
  coerceListingAttributes,
  validateListingAttributes,
  withListingEnquiry,
} from "@/lib/forms/listing-form";
import { CATEGORIES } from "@/lib/constants/categories";
import { ensureCsrfTokenReady, withCsrfHeaders } from "@/lib/utils/csrf";
import { checkUploadServiceReachable } from "@/lib/utils/upload-preflight";
import { loadDraft, type DraftEnvelope } from "@/lib/post-drafts/storage";
import { ContactSwitches, type ContactSwitchOption } from "@/components/post/contact-switches";
import {
  OnlinePresenceFields,
  type OnlinePresenceValues,
} from "@/components/post/online-presence-fields";
import { MediaLimitsLine } from "@/components/post/media-limits-line";
import { PostSubmittedScreen, createdPostId } from "@/components/post/post-submitted-screen";
import {
  finishListingAttributes,
  JOB_SAFETY_LINE,
  sentContactMethods,
} from "@/lib/domains/listings/market-extras";
import {
  EMPTY_MARKET_LINKS,
  MARKET_LINK_ERROR_ALIASES,
  marketLinksErrors,
  marketLinksPayload,
} from "@/lib/domains/listings/market-links";
import { LISTING_CONDITIONS } from "@/lib/constants/listing-condition";
import { ListingDetailContent } from "@/components/listings/listing-detail-content";
import { readMediaDimensions } from "@/lib/utils/media-metadata";
import { VIDEO_SOUND_OFF_TIP } from "@/lib/media/video-length";
import {
  announceTemplate,
  announceTemplateFailed,
  draftSnapshot,
  dropTemplateFromAddress,
  loadListingStart,
  TemplateLoading,
  templateLoading,
  type ListingStart,
  type MarketDraftData,
} from "./listing-template";
import { formFieldsFromTemplate } from "@/lib/post-templates";
import {
  LISTING_FIELD_STEPS,
  stepForField,
  stepForFieldErrors,
} from "@/app/post/_lib/post-field-steps";
import { ListingPriceFields } from "@/components/posting/listing-price-fields";
import {
  listingPricePreview,
  listingPriceSubmission,
  type ListingPriceForm,
} from "@/lib/domains/listings/price-form";

const STEPS: PostFormStep[] = [
  {
    label: "What are you listing?",
    icon: FileText,
    description: "Category, title and description",
  },
  {
    label: "Price, location & contact",
    icon: Tag,
    description: "Price, area and how buyers reach you",
  },
  { label: "Photos & review", icon: Camera, description: "Photos, video and review" },
];

const FIELD_SELECT_CLASS =
  "flex h-11 w-full rounded-xl border border-input bg-card px-3.5 py-2 text-base shadow-xs transition-colors hover:border-foreground/30 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 sm:h-10 sm:text-sm";

const TITLE_MAX = 100;
const DESC_MAX = 5000;

/** Call and WhatsApp use the account's verified number; private enquiry is always on (withListingEnquiry). */
const CONTACT_OPTIONS: readonly ContactSwitchOption[] = [
  { id: "call", label: "Phone call", usesVerifiedNumber: true },
  { id: "whatsapp", label: "WhatsApp", usesVerifiedNumber: true },
  { id: "in_app", label: "Private enquiry", locked: true },
];

const FIELD_IDS: Record<string, string> = {
  category: "listing-category-field",
  "attributes.property_type": "listing-attribute-property_type",
  "attributes.listing_intent": "listing-attribute-listing_intent",
  "attributes.bedrooms": "listing-attribute-bedrooms",
  "attributes.bathrooms": "listing-attribute-bathrooms",
  "attributes.floor_size_sqm": "listing-attribute-floor_size_sqm",
  "attributes.parking_spots": "listing-attribute-parking_spots",
  "attributes.furnished": "listing-attribute-furnished",
  "attributes.pets_allowed": "listing-attribute-pets_allowed",
  "attributes.make": "listing-attribute-make",
  "attributes.model": "listing-attribute-model",
  "attributes.year": "listing-attribute-year",
  "attributes.mileage_km": "listing-attribute-mileage_km",
  "attributes.transmission": "listing-attribute-transmission",
  "attributes.fuel_type": "listing-attribute-fuel_type",
  "attributes.service_history": "listing-attribute-service_history",
  "attributes.body_type": "listing-attribute-body_type",
  "attributes.colour": "listing-attribute-colour",
  "attributes.part_type": "listing-attribute-part_type",
  "attributes.part_condition": "listing-attribute-part_condition",
  "attributes.compatible_make": "listing-attribute-compatible_make",
  "attributes.compatible_model": "listing-attribute-compatible_model",
  "attributes.oem_or_aftermarket": "listing-attribute-oem_or_aftermarket",
  "attributes.device_type": "listing-attribute-device_type",
  "attributes.brand": "listing-attribute-brand",
  "attributes.model_name": "listing-attribute-model_name",
  "attributes.storage_gb": "listing-attribute-storage_gb",
  "attributes.screen_size_inches": "listing-attribute-screen_size_inches",
  "attributes.warranty_months": "listing-attribute-warranty_months",
  "attributes.sub_category": "listing-attribute-sub_category",
  "attributes.material": "listing-attribute-material",
  "attributes.job_type": "listing-attribute-job_type",
  "attributes.location_type": "listing-attribute-location_type",
  "attributes.farm_category": "listing-attribute-farm_category",
  "attributes.item_type": "listing-attribute-item_type",
  title: "title",
  description: "description",
  price_zar: "price",
  province: "province",
  city: "city",
  contactMethods: "listing-contact-methods",
  logo_url: "listing-logo-input",
  videoThumbnail: "listing-video-cover-input",
  images: "listing-images",
  videos: "listing-video",
  termsAccepted: "listing-terms-checkbox",
};

const LISTING_FIELD_KEY_ALIASES: Record<string, string> = {
  contact_methods: "contactMethods",
  location_province: "province",
  location_city: "city",
  ...MARKET_LINK_ERROR_ALIASES,
};

/** Human-readable labels for each form field key, used in the error alert. */
const LISTING_FIELD_LABELS: Record<string, string> = {
  category: "Category",
  title: "Title",
  description: "Description",
  price_zar: "Price",
  province: "Province",
  city: "City",
  contactMethods: "Contact methods",
  website: "Website",
  socialFacebook: "Facebook",
  socialInstagram: "Instagram",
  socialTiktok: "TikTok",
  socialYoutube: "YouTube",
  socialTwitter: "X (Twitter)",
  logo_url: "Listing logo",
  videoThumbnail: "Video cover image",
  images: "Photos",
  videos: "Videos",
  termsAccepted: "Posting terms",
};

function getFieldId(key: string | undefined): string | undefined {
  if (!key) return undefined;
  const normalizedKey = LISTING_FIELD_KEY_ALIASES[key] ?? key;
  if (FIELD_IDS[normalizedKey]) return FIELD_IDS[normalizedKey];
  // Category questions and links use their own input ids.
  if (normalizedKey.startsWith("attributes."))
    return `listing-attribute-${normalizedKey.slice(11)}`;
  if (normalizedKey === "website" || normalizedKey.startsWith("social")) return normalizedKey;
  return undefined;
}

function normalizeListingFieldErrors(errors: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, message] of Object.entries(errors)) {
    const normalizedKey = LISTING_FIELD_KEY_ALIASES[key] ?? key;
    if (!normalized[normalizedKey]) {
      normalized[normalizedKey] = message;
    }
  }
  return normalized;
}

function getStepForFieldKey(key: string): number {
  return stepForField(LISTING_FIELD_KEY_ALIASES[key] ?? key, LISTING_FIELD_STEPS);
}

function getStepForServerErrors(errors: Record<string, string>): number {
  return stepForFieldErrors(errors, LISTING_FIELD_STEPS, 2);
}

interface UploadStatuses {
  logo: UploadSlotStatus;
  photos: UploadSlotStatus;
  video: UploadSlotStatus;
  saving: UploadSlotStatus;
}

const INITIAL_UPLOAD_STATUSES: UploadStatuses = {
  logo: "idle",
  photos: "idle",
  video: "idle",
  saving: "idle",
};

/**
 * The Create listing page. The form is keyed on the copy it was opened with,
 * so if the page is kept alive between visits (client navigation), a copy and
 * the ordinary form (or a template) never share leftovers: moving to or from a
 * copy starts a fresh form. A template opened in a kept ordinary form is
 * handled by the form itself (it sets the work aside, with Undo).
 */
export default function CreateListingPage() {
  const searchParams = useSearchParams();
  return <CreateListingForm key={searchParams?.get("copy") ?? ""} />;
}

function CreateListingForm() {
  const { user, profile, isLoading } = useAuth();
  const categoryAnswers = useRef<Record<string, Record<string, string | boolean | string[]>>>({});
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [negotiable, setNegotiable] = useState(false);
  // "Amount" is preselected; Free and Price on request are one tap away.
  const [priceMode, setPriceMode] = useState<ListingPriceForm["mode"]>("amount");
  const priceForm: ListingPriceForm = { mode: priceMode, amount: price, negotiable };
  const [category, setCategory] = useState<ListingCategory | "">("");
  const [condition, setCondition] = useState<ListingCondition | "">("");
  const [categoryAttributes, setCategoryAttributes] = useState<
    Record<string, string | boolean | string[]>
  >({});
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [town, setTown] = useState("");
  const [address, setAddress] = useState("");
  const [contactMethods, setContactMethods] = useState<string[]>(DEFAULT_LISTING_CONTACT_METHODS);
  const [links, setLinks] = useState<OnlinePresenceValues>(EMPTY_MARKET_LINKS);
  const [logoFile, setLogoFile] = useState<File[]>([]);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [videoFile, setVideoFile] = useState<File[]>([]);
  const [videoCoverFile, setVideoCoverFile] = useState<File[]>([]);
  const [focalPoint, setFocalPoint] = useState<CropPosition>({ x: 0.5, y: 0.5 });
  const [trialDays, setTrialDays] = useState<7 | 30>(7);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submissionInFlightRef = useRef(false);
  const [submitProgress, setSubmitProgress] = useState<string | null>(null);
  const [uploadStatuses, setUploadStatuses] = useState<UploadStatuses>(INITIAL_UPLOAD_STATUSES);
  const uploadProgress = useUploadProgress();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [submitSucceeded, setSubmitSucceeded] = useState(false);
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  const router = useRouter();
  const {
    fields: postFields,
    captureRevision,
    needsTerms,
    acceptTerms,
    renewRequest,
  } = usePostTransport();
  // Copy a post (SHOW_POST_COPY): the form opened on a copy, a draft the server
  // made (?copy=<id>). It never touches the form's autosaved draft.
  const searchParams = useSearchParams();
  const copyId = SHOW_POST_COPY ? parseCopyId(searchParams?.get("copy")) : null;
  const [copyOf, setCopyOf] = useState<string | null>(null);
  const [copyLoading, setCopyLoading] = useState(copyId !== null);
  const [existingPhotos, setExistingPhotos] = useState<string[]>([]);
  const [existingLogo, setExistingLogo] = useState<string | null>(null);
  const copyActionFields = usePostActionFields();
  const { toast } = useToast();
  const {
    save: saveDraft,
    restore: restoreDraft,
    discard: discardDraft,
  } = usePostDraftAutosave<MarketDraftData>("listing", user?.id, !isLoading);
  const locationValue: LocationValue = { province, city, town, address };
  const maxPhotos = usePlanMaxPhotos("MZANSI_MARKET");
  const maxVideos = usePlanMaxVideos("MZANSI_MARKET");
  const videoAllowed = usePlanVideoAllowed("MZANSI_MARKET");
  const logoPreviewUrl = useMemo(
    () => (logoFile.length > 0 ? URL.createObjectURL(logoFile[0]) : null),
    [logoFile]
  );
  const photoPreviewUrls = useMemo(
    () => photoFiles.map((file) => URL.createObjectURL(file)),
    [photoFiles]
  );
  // A copy's photos (already stored) come first, then new ones.
  const allPhotoPreviewUrls = useMemo(
    () => [...existingPhotos.map((url) => normalizeMediaUrl(url)), ...photoPreviewUrls],
    [existingPhotos, photoPreviewUrls]
  );
  const cardLogoUrl = logoPreviewUrl ?? (existingLogo ? normalizeMediaUrl(existingLogo) : null);
  const videoPreviewUrl = useMemo(
    () => (videoFile.length > 0 ? URL.createObjectURL(videoFile[0]) : null),
    [videoFile]
  );
  const videoCoverPreviewUrl = useMemo(
    () => (videoCoverFile.length > 0 ? URL.createObjectURL(videoCoverFile[0]) : null),
    [videoCoverFile]
  );

  const listingCompleteness = useMemo(() => {
    const base = [
      !!title.trim(),
      !!description.trim(),
      !!price || priceMode === "free" || priceMode === "on_request",
      !!category,
      !!province,
      !!city,
      photoFiles.length + existingPhotos.length > 0,
      contactMethods.length > 0,
    ];
    const catDef = category ? CATEGORIES.find((c) => c.value === category) : undefined;
    const attrFields = (catDef?.attributeFields ?? []).filter((field) => {
      if (field.formHidden) return false;
      if (!field.dependsOnValue || !field.dependsOn) {
        return true;
      }

      const parentValue = categoryAttributes[field.dependsOn];
      if (parentValue === undefined || parentValue === null || parentValue === "") {
        return false;
      }

      const allowedValues = Array.isArray(field.dependsOnValue)
        ? field.dependsOnValue
        : [field.dependsOnValue];
      return allowedValues.includes(String(parentValue));
    });
    const attrFilled = attrFields.map((f: { name: string; type: string }) => {
      const v = categoryAttributes[f.name];
      if (v === undefined || v === "" || v === false) return false;
      if (Array.isArray(v) && v.length === 0) return false;
      return true;
    });
    const all = [...base, ...attrFilled];
    return all.length === 0 ? 0 : Math.round((all.filter(Boolean).length / all.length) * 100);
  }, [
    title,
    description,
    price,
    priceMode,
    category,
    province,
    city,
    photoFiles,
    existingPhotos,
    contactMethods,
    categoryAttributes,
  ]);

  const isPropertyRentListing =
    category === "property" && categoryAttributes["listing_intent"] === "rent";

  useEffect(
    () => () => {
      if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl);
    },
    [logoPreviewUrl]
  );

  useEffect(
    () => () => {
      photoPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
    },
    [photoPreviewUrls]
  );

  useEffect(
    () => () => {
      if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    },
    [videoPreviewUrl]
  );

  useEffect(
    () => () => {
      if (videoCoverPreviewUrl) URL.revokeObjectURL(videoCoverPreviewUrl);
    },
    [videoCoverPreviewUrl]
  );

  // While a template's fields are untouched (see settleStart), autosave waits
  // and Undo stays offered; `pristine` is the form as the template left it.
  const templateHold = useRef<{ pristine: string; end: () => void } | null>(null);
  useEffect(() => {
    const hold = templateHold;
    return () => hold.current?.end();
  }, []);

  useEffect(() => {
    // A template fills these itself (settleStart), so a later fill is no edit.
    if (!profile || templateHold.current) return;

    queueMicrotask(() => {
      if (!province && profile.location_province) {
        setProvince(profile.location_province);
      }

      if (!city && profile.location_city && (!province || province === profile.location_province)) {
        setCity(profile.location_city);
      }
    });
  }, [profile, province, city]);

  useEffect(() => {
    void ensureCsrfTokenReady();
  }, []);

  useEffect(() => {
    if (!copyId) return;
    let cancelled = false;
    void loadOwnListing(copyId)
      .then(({ data }) => {
        if (cancelled) return;
        if (!data || data.status !== "draft") throw new Error("Copy unavailable");
        const copy = listingCopyFields(data as Record<string, unknown>);
        captureRevision(data);
        setCopyOf(copy.title);
        setTitle(copy.title);
        setDescription(copy.description);
        setPrice(copy.price);
        setPriceMode(copy.priceMode);
        setNegotiable(copy.negotiable);
        setCategory(copy.category);
        setCondition(copy.condition);
        setCategoryAttributes(copy.attributes);
        setProvince(copy.province);
        setCity(copy.city);
        setTown(copy.town);
        setAddress(copy.address);
        setContactMethods(copy.contactMethods);
        setLinks(copy.links);
        setExistingPhotos(copy.photos);
        setExistingLogo(copy.logo);
        setFocalPoint(copy.focal);
        setStep(STEPS.length - 1);
      })
      .catch(() => {
        if (cancelled) return;
        toast({
          title: "This copy can't be opened",
          description: "It may have been submitted or deleted. Check My posts.",
          variant: "destructive",
        });
        router.push("/dashboard/listings");
      })
      .finally(() => {
        if (!cancelled) setCopyLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [copyId, captureRevision, router, toast]);

  useEffect(() => {
    // Preselect the category picked on /post/create (e.g. ?category=vehicles).
    // A restored draft still wins because it loads after this runs.
    const requested = new URLSearchParams(window.location.search).get("category");
    const match = CATEGORIES.find((c) => c.value === requested);
    if (!match) return;

    queueMicrotask(() => {
      setCategory(match.value);
      setCategoryAttributes(
        match.value === "vehicles" ? { year: String(new Date().getFullYear()) } : {}
      );
    });
  }, []);

  // The form's starting point, settled once in order: a template the address
  // names (SHOW_POST_TEMPLATES, ?template=<id>), else the autosaved draft. A
  // template that replaced a draft offers Undo, which puts the draft back.
  const started = useRef(false);
  // A kept page (opened again from Create Post) settles again only for a template.
  // A copy (?copy=<id>) never starts from a template.
  const templateParam = copyId ? null : (searchParams?.get("template") ?? null);
  const applyDraft = (restored: DraftEnvelope<MarketDraftData>) => {
    const restoredData = restored.data;
    setStep(Math.min(Math.max(restored.step ?? 0, 0), STEPS.length - 1));
    setTitle(restoredData.title ?? "");
    setDescription(restoredData.description ?? "");
    // A draft saved before the price choice existed used "0" to mean Free.
    const oldFreeDraft = !restoredData.priceMode && restoredData.price === "0";
    setPrice(oldFreeDraft ? "" : (restoredData.price ?? ""));
    setPriceMode(oldFreeDraft ? "free" : restoredData.priceMode || "amount");
    setNegotiable(Boolean(restoredData.negotiable));
    setCategory((restoredData.category as ListingCategory | "") ?? "");
    setCondition((restoredData.condition as ListingCondition | "") ?? "");
    setCategoryAttributes(restoredData.categoryAttributes ?? {});
    setProvince(restoredData.province ?? "");
    setCity(restoredData.city ?? "");
    setTown(restoredData.town ?? "");
    setAddress(restoredData.address ?? "");
    setContactMethods(
      Array.isArray(restoredData.contactMethods) && restoredData.contactMethods.length > 0
        ? withListingEnquiry(restoredData.contactMethods)
        : DEFAULT_LISTING_CONTACT_METHODS
    );
    setLinks({ ...EMPTY_MARKET_LINKS, ...restoredData.links });
    setLastSavedAt(restored.savedAt ?? null);
    toast({
      title: "Draft restored",
      description: "You can continue from where you left off.",
      variant: "success",
    });
  };
  const settleStart = useEffectEvent((start: ListingStart<MarketDraftData>, again: boolean) => {
    dropTemplateFromAddress();
    if (start.templateFailed) announceTemplateFailed(toast);
    const { template } = start;
    if (!template) {
      if (start.draft && !again) applyDraft(start.draft);
      return;
    }
    // What the template replaces: the saved draft on a first visit, or the work
    // in the form when a kept page is opened again with a template.
    const formData: MarketDraftData = {
      category,
      condition,
      categoryAttributes,
      title,
      description,
      price,
      priceMode,
      negotiable,
      province,
      city,
      town,
      address,
      contactMethods,
      links,
    };
    const files = { photoFiles, videoFile, videoCoverFile };
    const draft = again
      ? title || description || category
        ? { v: 1, savedAt: Date.now(), step, data: formData }
        : null
      : start.draft;
    templateHold.current?.end();
    const fields = formFieldsFromTemplate(template.data);
    // The member's area when the template has none, as an empty form gets it.
    const filled: MarketDraftData = {
      ...fields,
      links: EMPTY_MARKET_LINKS,
      title: "",
      price: "",
      priceMode: "amount",
      negotiable: false,
      province: fields.province || profile?.location_province || "",
      city:
        fields.city ||
        (!fields.province || fields.province === profile?.location_province
          ? profile?.location_city || ""
          : ""),
    };
    setStep(0);
    setTitle("");
    setPrice("");
    setPriceMode("amount");
    setNegotiable(false);
    setPhotoFiles([]);
    setVideoFile([]);
    setVideoCoverFile([]);
    setCategory(fields.category as ListingCategory);
    setCondition(fields.condition as ListingCondition | "");
    setCategoryAttributes(fields.categoryAttributes);
    setDescription(fields.description);
    setProvince(filled.province);
    setCity(filled.city);
    setTown(fields.town);
    setAddress(fields.address);
    setContactMethods(fields.contactMethods);
    setLinks(EMPTY_MARKET_LINKS);
    const userId = user?.id;
    const undo = draft
      ? () => {
          // First visit: the stored draft as it is now (another tab may have
          // saved newer work), since the template's fields were never saved.
          applyDraft(
            (!again && userId ? loadDraft<MarketDraftData>("listing", userId) : null) ?? draft
          );
          if (again) {
            setPhotoFiles(files.photoFiles);
            setVideoFile(files.videoFile);
            setVideoCoverFile(files.videoCoverFile);
          }
        }
      : null;
    // Untouched template fields are not autosaved (a reload restores the earlier
    // draft) and Undo stays offered; the first change to the form ends both.
    const shown = announceTemplate(toast, template, undo);
    templateHold.current = { pristine: draftSnapshot(filled), end: () => shown.dismiss() };
  });

  useEffect(() => {
    if (copyId || !user?.id || isLoading || submitSucceeded) return;
    if (started.current && !templateParam) return;
    const again = started.current;
    let cancelled = false;
    // A kept page reads no saved draft: the form holds the latest work.
    void loadListingStart<MarketDraftData>(again ? () => null : restoreDraft).then((start) => {
      if (cancelled) return;
      started.current = true;
      queueMicrotask(() => settleStart(start, again));
    });
    return () => {
      cancelled = true;
    };
  }, [copyId, user?.id, isLoading, submitSucceeded, restoreDraft, templateParam]);

  useEffect(() => {
    if (copyId || !user?.id || isLoading || isSubmitting || submitSucceeded) return;
    const data: MarketDraftData = {
      category,
      condition,
      categoryAttributes,
      title,
      description,
      price,
      priceMode,
      negotiable,
      province,
      city,
      town,
      address,
      contactMethods,
      links,
    };
    const hold = templateHold.current;
    if (hold) {
      if (hold.pristine === draftSnapshot(data)) return;
      templateHold.current = null;
      hold.end();
    }
    saveDraft(step, data);
    queueMicrotask(() => {
      setLastSavedAt(Date.now());
    });
  }, [
    copyId,
    user?.id,
    isLoading,
    isSubmitting,
    submitSucceeded,
    saveDraft,
    step,
    category,
    condition,
    categoryAttributes,
    title,
    description,
    price,
    priceMode,
    negotiable,
    province,
    city,
    town,
    address,
    contactMethods,
    links,
  ]);

  function clearErrors(...keys: string[]) {
    setFormError(null);
    if (keys.length === 0) {
      setFieldErrors({});
      return;
    }

    setFieldErrors((current) => {
      const next = { ...current };
      for (const key of keys) delete next[key];
      return next;
    });
  }

  function focusFirstError(errors: Record<string, string>, targetStep = step) {
    const orderByStep = [
      ["category", "title", "description"],
      [
        "price_zar",
        "province",
        "city",
        "contactMethods",
        "website",
        "socialFacebook",
        "socialInstagram",
        "socialTwitter",
        "socialTiktok",
        "socialYoutube",
      ],
      ["images", "videos", "termsAccepted"],
    ][targetStep];

    const firstKey = orderByStep?.find((key) => errors[key]) ?? Object.keys(errors)[0];
    if (!firstKey) return;
    const targetId = getFieldId(firstKey);

    if (!targetId) return;

    requestAnimationFrame(() => {
      const element = document.getElementById(targetId);
      element?.focus();
      element?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  function validateStep(targetStep: number) {
    const errors: Record<string, string> = {};

    if (targetStep === 0) {
      if (!category) errors.category = "Select a category.";
      if (!title.trim()) errors.title = "Enter a title.";
      else if (title.trim().length < 5) errors.title = "Title must be at least 5 characters.";
      else if (title.trim().length > TITLE_MAX)
        errors.title = `Title must be ${TITLE_MAX} characters or fewer.`;

      if (!description.trim()) errors.description = "Enter a description.";
      else if (description.trim().length < 20)
        errors.description = "Description must be at least 20 characters.";
      else if (description.trim().length > DESC_MAX)
        errors.description = `Description must be ${DESC_MAX} characters or fewer.`;

      if (category) {
        Object.assign(errors, validateListingAttributes(category, categoryAttributes));
      }
    }

    if (targetStep === 1) {
      const priced = listingPriceSubmission(category, priceForm);
      if ("error" in priced) errors.price_zar = priced.error;
      if (!province) errors.province = "Select a province.";
      if (!city) errors.city = "Select a city.";
      if (province.trim().length > 50) {
        errors.province = "Province must be 50 characters or fewer.";
      }
      if (city.trim().length > 80) {
        errors.city = "City must be 80 characters or fewer.";
      }
      if (town.trim().length > 120) {
        errors.town = "Town / suburb must be 120 characters or fewer.";
      }
      if (address.trim().length > 300) {
        errors.address = "Address must be 300 characters or fewer.";
      }
      if (contactMethods.length === 0) {
        errors.contactMethods = "Choose at least one contact method.";
      }
      Object.assign(errors, marketLinksErrors(links));
    }

    if (targetStep === 2) {
      const photoCount = existingPhotos.length + photoFiles.length;
      const hasVideoCover = videoFile.length > 0 && videoCoverFile.length > 0;
      if (category !== "jobs_services" && photoCount === 0 && !hasVideoCover)
        errors.images = videoFile.length > 0 ? VIDEO_COVER_NEEDED : PHOTO_OR_VIDEO_RULE;
      if (photoCount > maxPhotos) {
        errors.images = `You can upload up to ${maxPhotos} photos on this plan.`;
      }

      if (videoFile.length > 0 && !videoAllowed) {
        errors.videos = "Video upload is not available on your current plan.";
      } else if (videoFile.length > maxVideos) {
        errors.videos = `You can upload up to ${maxVideos} videos on this plan.`;
      }
      // A copy is saved like an edit: the tick shows only when the current terms
      // are not accepted yet.
      if ((!copyId || needsTerms) && !termsAccepted)
        errors.termsAccepted = "Accept the posting terms before submitting.";
    }

    return errors;
  }

  function handleCategoryChange(nextCategory: ListingCategory) {
    categoryAnswers.current[category] = categoryAttributes;
    setCategory(nextCategory);
    setCategoryAttributes(
      categoryAnswers.current[nextCategory] ??
        (nextCategory === "vehicles" ? { year: String(new Date().getFullYear()) } : {})
    );
    clearErrors("category");
  }

  function handleAttributeChange(name: string, value: string | boolean | string[]) {
    setCategoryAttributes((prev) => ({ ...prev, [name]: value }));
  }

  function changeContacts(next: string[]) {
    setContactMethods(withListingEnquiry(next));
    clearErrors("contactMethods");
  }

  /** Scroll to top and focus the first field of the target step */
  function scrollToStepTop(targetStep: number) {
    const firstFieldByStep = ["listing-category-field", "price", "listing-images"];
    requestAnimationFrame(() => {
      document
        .getElementById("post-form-top")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      const fieldId = firstFieldByStep[targetStep];
      if (fieldId) {
        const el = document.getElementById(fieldId);
        el?.focus({ preventScroll: true });
      }
    });
  }

  function goNext() {
    // Validate all steps up to and including the current step
    for (let i = 0; i <= step; i++) {
      const errors = validateStep(i);
      if (Object.keys(errors).length > 0) {
        if (i !== step) setStep(i);
        setFieldErrors((current) => ({ ...current, ...errors }));
        const count = Object.keys(errors).length;
        setFormError(
          `Please fix ${count} field${count > 1 ? "s" : ""} on Step ${i + 1} \u2014 ${STEPS[i].label}.`
        );
        focusFirstError(errors, i);
        return;
      }
    }

    clearErrors();
    const next = Math.min(step + 1, STEPS.length - 1);
    setStep(next);
    scrollToStepTop(next);
  }

  function goBack() {
    clearErrors();
    const prev = Math.max(step - 1, 0);
    setStep(prev);
    scrollToStepTop(prev);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    // Ref-based guard: prevent concurrent/duplicate submissions even across re-renders
    if (submissionInFlightRef.current) return;
    setSessionExpired(false);

    const stepErrors = [0, 1, 2].map((index) => validateStep(index));
    const firstInvalidStep = stepErrors.findIndex((errors) => Object.keys(errors).length > 0);

    if (firstInvalidStep !== -1) {
      setStep(firstInvalidStep);
      setFieldErrors(stepErrors[firstInvalidStep]);
      const count = Object.keys(stepErrors[firstInvalidStep]).length;
      setFormError(
        `Please fix ${count} field${count > 1 ? "s" : ""} on Step ${firstInvalidStep + 1} \u2014 ${STEPS[firstInvalidStep].label}.`
      );
      requestAnimationFrame(() => focusFirstError(stepErrors[firstInvalidStep], firstInvalidStep));
      return;
    }

    clearErrors();
    setIsSubmitting(true);
    submissionInFlightRef.current = true;
    setSubmitProgress("Checking upload service...");
    uploadProgress.reset();
    setUploadStatuses({
      logo: logoFile.length > 0 ? "uploading" : "skipped",
      photos: photoFiles.length > 0 ? "uploading" : "skipped",
      video: videoFile.length > 0 ? "uploading" : "skipped",
      saving: "idle",
    });

    try {
      const csrfToken = await ensureCsrfTokenReady();
      if (!csrfToken) {
        setFormError("Security check failed. Please refresh the page and try again.");
        return;
      }

      // A copy accepts the terms itself, first: if that fails, nothing has
      // been uploaded.
      if (copyId && needsTerms) await acceptTerms();

      // Best-effort preflight — never block the form on a health check.
      try {
        await checkUploadServiceReachable();
      } catch {
        // logged inside checkUploadServiceReachable; continue to real upload
      }
      setSubmitProgress("Uploading media...");

      const normalizedAttributes = category
        ? finishListingAttributes(category, coerceListingAttributes(category, categoryAttributes))
        : {};

      const [logoUrls, photoUrls, videoUrls, videoThumbnailUrl] = await settleMediaUploads([
        uploadListingImages({
          files: logoFile,
          area: "listing_logo",
          field: "logo_url",
          onProgress: uploadProgress.track("logo", logoFile),
        }).then((urls) => {
          if (logoFile.length) setUploadStatuses((current) => ({ ...current, logo: "done" }));
          return urls;
        }),
        uploadListingImages({
          files: photoFiles,
          area: "listing",
          field: "images",
          onProgress: uploadProgress.track("photos", photoFiles),
        }).then((urls) => {
          if (photoFiles.length) setUploadStatuses((current) => ({ ...current, photos: "done" }));
          return urls;
        }),
        uploadListingVideoFiles({
          files: videoFile,
          area: "listing_video",
          onProgress: uploadProgress.trackVideo("video", videoFile),
        }).then((urls) => {
          if (videoFile.length) setUploadStatuses((current) => ({ ...current, video: "done" }));
          return urls;
        }),
        uploadListingImages({
          files: videoCoverFile,
          area: "listing",
          field: "videoThumbnail",
        }).then((urls) => urls[0] ?? null),
      ]);

      setSubmitProgress("Saving listing...");
      setUploadStatuses((current) => ({ ...current, saving: "uploading" }));
      const primaryMediaFile = videoFile[0] ?? photoFiles[0] ?? null;
      const mediaDimensions = primaryMediaFile ? await readMediaDimensions(primaryMediaFile) : null;

      const priced = listingPriceSubmission(category, priceForm);
      if ("error" in priced) throw new Error(priced.error);
      const body = {
        ...postFields(copyId !== null),
        title: title.trim(),
        description: description.trim(),
        ...priced,
        category: mapListingCategory(category),
        condition:
          category === "jobs_services" || category === "auto_parts"
            ? undefined
            : condition || undefined,
        attributes: normalizedAttributes,
        province,
        city,
        town,
        address,
        logo_url: logoUrls[0] || existingLogo || null,
        images: photosWithVideoCover(
          [...existingPhotos, ...photoUrls],
          videoUrls.length > 0,
          videoThumbnailUrl
        ),
        videos: videoUrls,
        videoThumbnail: videoThumbnailUrl,
        contactMethods: sentContactMethods(contactMethods, profile),
        ...marketLinksPayload(links),
        media_width: mediaDimensions?.width,
        media_height: mediaDimensions?.height,
        focal_x: focalPoint.x,
        focal_y: focalPoint.y,
        termsAccepted,

        trialDays,
      };
      const res = copyId
        ? await submitListingCopy(
            copyId,
            body,
            (revision) =>
              copyActionFields(copyId, revision, "resubmit", "MZANSI_MARKET", "listing"),
            (savedRevision) => {
              if (savedRevision !== null) captureRevision({ revision: savedRevision });
              renewRequest();
            }
          )
        : await fetch("/api/listings", {
            method: "POST",
            headers: withCsrfHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify(body),
          });
      // The new post's id, for the Submitted screen's link (read from a copy of the answer).
      if (res.ok) setSubmittedId(await createdPostId(res));

      if (!res.ok) {
        const payload = await res.json().catch(() => null);

        if (res.status === 401) {
          setSessionExpired(true);
          setFormError(POST_SESSION_EXPIRED_MESSAGE);
          return;
        }

        // Phone-gate: server returns redirectUrl for phone verification
        if (
          res.status === 403 &&
          payload &&
          typeof payload === "object" &&
          typeof (payload as Record<string, unknown>).redirectUrl === "string"
        ) {
          router.push(resolveServerRedirect((payload as Record<string, unknown>).redirectUrl));
          return;
        }

        // Plan-limit: show a descriptive upgrade message
        if (
          res.status === 403 &&
          payload &&
          typeof payload === "object" &&
          typeof (payload as Record<string, unknown>).reason === "string"
        ) {
          setFormError((payload as Record<string, unknown>).reason as string);
          return;
        }

        if (
          res.status === 422 &&
          payload &&
          typeof payload === "object" &&
          typeof (payload as Record<string, unknown>).error === "string"
        ) {
          const message = ((payload as Record<string, unknown>).error as string).trim();
          const lower = message.toLowerCase();
          if (lower.includes("photo")) {
            const errors = { images: message };
            setStep(2);
            setFieldErrors(errors);
            setFormError(`Please fix 1 field on Step 3 — ${STEPS[2].label}.`);
            focusFirstError(errors, 2);
            return;
          }
          if (lower.includes("video")) {
            const errors = { videos: message };
            setStep(2);
            setFieldErrors(errors);
            setFormError(`Please fix 1 field on Step 3 — ${STEPS[2].label}.`);
            focusFirstError(errors, 2);
            return;
          }
        }

        const normalized = normalizeCreatePostError(payload, "Failed to create listing.");
        const normalizedFieldErrors = normalizeListingFieldErrors(normalized.fieldErrors);
        const targetStep = getStepForServerErrors(normalizedFieldErrors);
        const count = Object.keys(normalizedFieldErrors).length;
        if (count > 0) {
          setStep(targetStep);
        }
        setFieldErrors(normalizedFieldErrors);
        setFormError(
          count > 0
            ? `Please fix ${count} field${count > 1 ? "s" : ""} on Step ${targetStep + 1} \u2014 ${STEPS[targetStep].label}.`
            : normalized.formError
        );
        if (count > 0) {
          focusFirstError(normalizedFieldErrors, targetStep);
        }
        return;
      }

      // The submitted screen replaces the form (no pop-up, no redirect).
      setSubmitSucceeded(true);
      if (!copyId) discardDraft();
      setUploadStatuses((current) => ({ ...current, saving: "done" }));
    } catch (error: unknown) {
      const uploadFailure = getListingMediaUploadErrorState(error);
      if (uploadFailure) {
        setStep(2);
        setFieldErrors(uploadFailure.fieldErrors);
        setFormError(uploadFailure.formError);
        focusFirstError(uploadFailure.fieldErrors, 2);
        return;
      }
      setFormError(normalizeCreatePostRuntimeError(error, "Something went wrong."));
    } finally {
      setIsSubmitting(false);
      submissionInFlightRef.current = false;
      setSubmitProgress(null);
      setUploadStatuses(INITIAL_UPLOAD_STATUSES);
    }
  }

  // The previews show the seller's choice: an amount, "Free" or "Price on request".
  const { priceMode: previewPriceMode, priceCents: previewPriceCents } = listingPricePreview(
    category,
    priceForm
  );

  function handleDiscardDraft() {
    discardDraft();
    setStep(0);
    setTitle("");
    setDescription("");
    setPrice("");
    setPriceMode("amount");
    setNegotiable(false);
    setCategory("");
    setCondition("");
    setCategoryAttributes({});
    setProvince(profile?.location_province ?? "");
    setCity(profile?.location_city ?? "");
    setTown("");
    setAddress("");
    setContactMethods(DEFAULT_LISTING_CONTACT_METHODS);
    setLinks(EMPTY_MARKET_LINKS);
    setLogoFile([]);
    setPhotoFiles([]);
    setVideoFile([]);
    setVideoCoverFile([]);
    setFieldErrors({});
    setFormError(null);
    setLastSavedAt(null);
    toast({
      title: "Draft discarded",
      description: "You can start a fresh listing now.",
      variant: "success",
    });
  }

  function renderCardPreview() {
    const normalizedAttributes = category
      ? coerceListingAttributes(category, categoryAttributes)
      : {};
    const cardMediaUrl = videoPreviewUrl || allPhotoPreviewUrls[0];
    const cardPosterUrl = videoCoverPreviewUrl || allPhotoPreviewUrls[0] || undefined;

    return (
      <ListingCard
        id="preview-listing"
        title={title || "Your listing title"}
        price={previewPriceCents}
        priceMode={previewPriceMode}
        imageUrl={cardMediaUrl || undefined}
        posterUrl={cardPosterUrl}
        isVideo={videoFile.length > 0}
        fitStrategy="contain"
        logoUrl={cardLogoUrl}
        province={province || "Province"}
        city={city || "City"}
        category={category || "property"}
        attributes={normalizedAttributes}
        condition={condition || undefined}
        createdAt={new Date().toISOString()}
      />
    );
  }

  function renderPreviewAside() {
    return (
      <div className="surface-card space-y-3 p-4">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Eye className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Card preview
          </p>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">Updates as you type.</p>
        </div>
        <div className="pointer-events-none mx-auto max-w-[280px]" inert>
          {renderCardPreview()}
        </div>
      </div>
    );
  }

  function renderPreview() {
    const normalizedAttributes = category
      ? finishListingAttributes(category, coerceListingAttributes(category, categoryAttributes))
      : {};
    const previewLinks = marketLinksPayload(links);

    return (
      <section
        aria-labelledby="listing-preview-heading"
        className="rounded-2xl border border-dashed border-border bg-muted/30 p-4"
      >
        <h3
          id="listing-preview-heading"
          className="mb-1 flex items-center gap-2 text-base font-semibold text-foreground"
        >
          <Eye className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Listing preview
        </h3>
        <p className="mb-4 text-sm text-muted-foreground">What buyers see once it's approved.</p>

        <div className="mb-4 max-w-[264px]">{renderCardPreview()}</div>

        <ListingDetailContent
          listing={{
            id: "preview-listing",
            owner_id: "preview-owner",
            title: title || "Your listing title",
            description: description || "Your listing description will appear here.",
            price_cents: previewPriceCents,
            price_mode: previewPriceMode,
            price_negotiable: negotiable,
            category: category || null,
            condition: condition || null,
            attributes: normalizedAttributes,
            photos: allPhotoPreviewUrls,
            videos: videoPreviewUrl ? [videoPreviewUrl] : [],
            video_thumbnail: videoCoverPreviewUrl,
            logo_url: cardLogoUrl,
            location_province: province || null,
            location_city: city || null,
            location_suburb: town || null,
            location_address: address || null,
            contact_methods: sentContactMethods(contactMethods, profile),
            website: previewLinks.website,
            social_links: previewLinks.social_links,
            created_at: new Date().toISOString(),
          }}
          seller={{
            display_name: "You",
            location_province: province || null,
            location_city: city || null,
            account_verification_status: null,
          }}
          showContactActions={false}
          showSimilarListings={false}
          photoCount={allPhotoPreviewUrls.length}
          trackView={false}
          layoutMode="review"
        />
      </section>
    );
  }

  if (copyLoading) {
    return (
      <div className="flex min-h-screen flex-col">
        <Header isAuthenticated />
        <main
          id="main-content"
          aria-busy="true"
          className="flex flex-1 flex-col items-center justify-center gap-3"
        >
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">Loading your copy…</p>
        </main>
      </div>
    );
  }

  // While a template (?template=<id>) loads, the form waits, so nothing typed is lost.
  if (templateLoading(templateParam)) return <TemplateLoading />;

  if (submitSucceeded) {
    return (
      <div className="flex min-h-screen flex-col">
        <Header isAuthenticated />
        <main id="main-content" className="flex-1">
          <div className="container-page py-10">
            <PostSubmittedScreen
              postTitle={title.trim()}
              area="MZANSI_MARKET"
              postId={copyId ?? submittedId}
            />
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header isAuthenticated />

      <main id="main-content" className="flex-1">
        <div className="container-page py-6">
          <PlanGate area="MZANSI_MARKET" onTrialSelected={setTrialDays}>
            <form noValidate onSubmit={handleSubmit}>
              <PostFormScaffold
                title="Post an item"
                description="Required fields are marked."
                breadcrumbs={[
                  { label: "Dashboard", href: "/dashboard" },
                  { label: "Create Post", href: "/post/create" },
                  { label: "Mzansi Market" },
                ]}
                badgeLabel="Mzansi Market"
                area="market"
                steps={STEPS}
                onStepChange={setStep}
                onFieldError={(key) => focusFirstError({ [key]: fieldErrors[key] })}
                currentStep={step}
                completeness={listingCompleteness}
                aside={renderPreviewAside()}
                notice={copyOf !== null ? <CopyNotice title={copyOf} /> : undefined}
                error={formError}
                fieldErrors={fieldErrors}
                fieldLabels={LISTING_FIELD_LABELS}
                errorStepLabel={
                  formError ? `Step ${step + 1} \u2014 ${STEPS[step].label}` : undefined
                }
                stepHasErrors={STEPS.map((_, i) =>
                  // Only flag steps after a validation attempt has surfaced
                  // errors — never show red on a pristine form.
                  Object.keys(fieldErrors).some((key) => getStepForFieldKey(key) === i)
                )}
                errorAction={sessionExpired && formError ? <PostSignInAction /> : undefined}
                onRetry={
                  formError && !isSubmitting && !sessionExpired
                    ? () => handleSubmit(new Event("submit") as unknown as React.FormEvent)
                    : undefined
                }
                footer={
                  <>
                    {user?.id && !isSubmitting && !copyId && (
                      <PostDraftStatus lastSavedAt={lastSavedAt} onDiscard={handleDiscardDraft} />
                    )}

                    {isSubmitting && (
                      <UploadProgressPanel
                        visible={isSubmitting}
                        progress={uploadProgress.values}
                        slots={[
                          {
                            key: "logo",
                            label: "Uploading logo...",
                            doneLabel: "Logo uploaded",
                            status: logoFile.length > 0 ? uploadStatuses.logo : "skipped",
                          },
                          {
                            key: "photos",
                            label: "Uploading photos...",
                            doneLabel: "Photos uploaded",
                            status: photoFiles.length > 0 ? uploadStatuses.photos : "skipped",
                          },
                          {
                            key: "video",
                            label: "Preparing and verifying video...",
                            doneLabel: "Video verified",
                            status: videoFile.length > 0 ? uploadStatuses.video : "skipped",
                          },
                          {
                            key: "saving",
                            label: "Saving listing...",
                            doneLabel: "Listing saved",
                            status: uploadStatuses.saving,
                          },
                        ]}
                      />
                    )}

                    <PostFormFooter
                      currentStep={step}
                      totalSteps={STEPS.length}
                      onBack={goBack}
                      onNext={goNext}
                      submitDisabled={isSubmitting}
                      isSubmitting={isSubmitting}
                      submittingLabel={submitProgress || "Submitting..."}
                    />
                  </>
                }
              >
                {step === 0 && (
                  <div className="space-y-5 animate-in fade-in-0 duration-300">
                    <div
                      id="listing-category-field"
                      tabIndex={-1}
                      className={cn(
                        "rounded-xl p-1 transition-colors",
                        fieldErrors.category && "rounded-xl border border-destructive/60"
                      )}
                    >
                      <CategoryPicker
                        value={category}
                        onChange={handleCategoryChange}
                        attributes={categoryAttributes}
                        onAttributeChange={handleAttributeChange}
                        errors={fieldErrors}
                      />
                    </div>
                    {fieldErrors.category && (
                      <p className="inline-form-error">{fieldErrors.category}</p>
                    )}
                    {category === "jobs_services" && (
                      <div className="space-y-2 rounded-md bg-muted p-3 text-sm text-muted-foreground">
                        <p>
                          Jobs are for vacancies you want to fill. If you offer a service, such as
                          plumbing or hairdressing, customers find you more easily through a{" "}
                          <Link href="/post/create-business" className="font-medium underline">
                            business profile
                          </Link>
                          .
                        </p>
                        <p role="note" className="font-semibold text-foreground">
                          {JOB_SAFETY_LINE}
                        </p>
                      </div>
                    )}

                    <PostFormSection title="Describe it">
                      {category !== "jobs_services" && category !== "auto_parts" && (
                        <div className="space-y-2">
                          <Label htmlFor="condition">Condition</Label>
                          <PostSelect
                            id="condition"
                            aria-label="Condition"
                            className={FIELD_SELECT_CLASS}
                            value={condition}
                            onChange={(event) => {
                              setCondition(event.target.value as ListingCondition | "");
                              // Auto-focus the title field after selecting condition
                              requestAnimationFrame(() => {
                                const el = document.getElementById("title");
                                if (el) {
                                  el.focus();
                                  el.scrollIntoView({ behavior: "smooth", block: "center" });
                                }
                              });
                            }}
                          >
                            <option value="">Condition not specified</option>
                            {LISTING_CONDITIONS.map((item) => (
                              <option key={item.value} value={item.value}>
                                {item.label}
                              </option>
                            ))}
                          </PostSelect>
                        </div>
                      )}

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label htmlFor="title">Title *</Label>
                          <span
                            className={cn(
                              "text-xs",
                              title.length > TITLE_MAX * 0.9
                                ? "font-medium text-destructive"
                                : "text-muted-foreground"
                            )}
                          >
                            {title.length}/{TITLE_MAX}
                          </span>
                        </div>
                        <Input
                          id="title"
                          value={title}
                          onChange={(event) => {
                            setTitle(event.target.value.slice(0, TITLE_MAX));
                            clearErrors("title");
                          }}
                          placeholder="e.g. iPhone 15 Pro Max 256GB"
                          maxLength={TITLE_MAX}
                          aria-invalid={!!fieldErrors.title}
                          className={cn(fieldErrors.title && "border-destructive")}
                        />
                        {fieldErrors.title && (
                          <p className="inline-form-error">{fieldErrors.title}</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label htmlFor="description">Description *</Label>
                          <span
                            className={cn(
                              "text-xs",
                              description.length > DESC_MAX * 0.9
                                ? "font-medium text-destructive"
                                : "text-muted-foreground"
                            )}
                          >
                            {description.length}/{DESC_MAX}
                          </span>
                        </div>
                        <Textarea
                          id="description"
                          value={description}
                          onChange={(event) => {
                            setDescription(event.target.value.slice(0, DESC_MAX));
                            clearErrors("description");
                          }}
                          placeholder="What is it, what condition is it in, what's included, and why are you selling?"
                          className={cn(
                            "min-h-[120px]",
                            fieldErrors.description && "border-destructive"
                          )}
                          aria-invalid={!!fieldErrors.description}
                        />
                        {fieldErrors.description && (
                          <p className="inline-form-error">{fieldErrors.description}</p>
                        )}
                      </div>
                    </PostFormSection>
                  </div>
                )}

                {step === 1 && (
                  <div className="space-y-6">
                    <PostFormSection
                      title={category === "jobs_services" ? "Salary (Optional)" : "Price"}
                    >
                      {category !== "jobs_services" ? (
                        <ListingPriceFields
                          category={category || "other_items"}
                          value={priceForm}
                          onChange={(next) => {
                            setPriceMode(next.mode);
                            setPrice(next.amount);
                            setNegotiable(next.negotiable);
                            clearErrors("price_zar");
                          }}
                          amountId="price"
                          amountLabel={
                            isPropertyRentListing ? "Monthly Rent (ZAR)" : "Asking price (ZAR)"
                          }
                          error={fieldErrors.price_zar}
                        />
                      ) : (
                        <div className="space-y-2">
                          <Label htmlFor="price">Salary (ZAR) (Optional)</Label>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground">
                              R
                            </span>
                            <Input
                              id="price"
                              type="number"
                              inputMode="decimal"
                              min="0"
                              step="0.01"
                              value={price}
                              onChange={(event) => {
                                setPrice(event.target.value);
                                clearErrors("price_zar");
                              }}
                              placeholder="0.00"
                              className={cn("pl-8", fieldErrors.price_zar && "border-destructive")}
                              aria-invalid={!!fieldErrors.price_zar}
                            />
                          </div>
                          {fieldErrors.price_zar && (
                            <p className="inline-form-error">{fieldErrors.price_zar}</p>
                          )}
                        </div>
                      )}
                    </PostFormSection>

                    <PostFormSection
                      title="Where is it?"
                      description="Your street address stays private."
                    >
                      <LocationSelector
                        value={locationValue}
                        onChange={(v) => {
                          setProvince(v.province);
                          setCity(v.city);
                          setTown(v.town ?? "");
                          setAddress(v.address ?? "");
                          clearErrors("province", "city");
                        }}
                        cityLabel="City"
                        showTown
                        showAddress
                        errors={{
                          province: fieldErrors.province,
                          city: fieldErrors.city,
                        }}
                      />
                    </PostFormSection>

                    <ContactSwitches
                      id="listing-contact-methods"
                      legend="How buyers reach you"
                      options={CONTACT_OPTIONS}
                      selected={contactMethods}
                      onChange={changeContacts}
                      verifiedPhone={profile?.phone}
                      error={fieldErrors.contactMethods}
                    />

                    <OnlinePresenceFields
                      values={links}
                      onChange={(field, value) => {
                        setLinks((current) => ({ ...current, [field]: value }));
                        clearErrors(field);
                      }}
                      errors={fieldErrors}
                      showMapPin={false}
                      title="Website and social media"
                      description="Optional. Buyers can tap them on your post."
                    />
                  </div>
                )}

                {step === 2 && (
                  <div className="space-y-6">
                    <PostFormSection
                      title="Photos and video"
                      description={
                        category === "jobs_services"
                          ? "Your first photo is the cover."
                          : `${PHOTO_OR_VIDEO_RULE} Your first photo is the cover.`
                      }
                    >
                      <MediaLimitsLine />
                      <div id="listing-images" tabIndex={-1} className="space-y-2 rounded-lg">
                        <MediaUpload
                          id="listing-images-input"
                          label={`Photos (max ${maxPhotos})`}
                          description={
                            category === "jobs_services"
                              ? "Optional for job vacancies."
                              : "With only a video, the cover frame you choose becomes the first photo."
                          }
                          error={fieldErrors.images}
                          maxFiles={maxPhotos}
                          files={photoFiles}
                          existing={existingPhotos.map((url, i) => ({
                            url: normalizeMediaUrl(url),
                            label: `Photo ${i + 1}`,
                          }))}
                          onRemoveExisting={(index) => {
                            setExistingPhotos((prev) => prev.filter((_, i) => i !== index));
                            clearErrors("images");
                          }}
                          onChange={(files) => {
                            setPhotoFiles(files);
                            clearErrors("images");
                          }}
                          accept="image/*"
                        />
                        <PhotoOrderList files={photoFiles} onReorder={setPhotoFiles} />
                      </div>

                      {photoFiles.length > 0 &&
                        videoFile.length === 0 &&
                        existingPhotos.length === 0 && (
                          <MediaCropPreview
                            file={photoFiles[0]}
                            value={focalPoint}
                            onChange={setFocalPoint}
                          />
                        )}

                      {copyId ? <CopyVideoNote /> : null}
                      <div id="listing-video" tabIndex={-1} className="space-y-2 rounded-lg">
                        <MediaUpload
                          id="listing-video-input"
                          label={`Video (max ${maxVideos})${!videoAllowed ? " — Upgrade to unlock" : ""}`}
                          description={`${category === "jobs_services" ? "Optional. " : ""}Upright clips work best; put the best part first. ${VIDEO_SOUND_OFF_TIP}`}
                          error={fieldErrors.videos}
                          maxFiles={maxVideos}
                          files={videoFile}
                          onChange={(files) => {
                            setVideoFile(files);
                            prewarmVideosForFastUpload(files);
                            if (files.length === 0) setVideoCoverFile([]);
                            clearErrors("videos");
                          }}
                          accept="video/*"
                          previewShape="wide"
                          disabled={!videoAllowed}
                        />
                        {!videoAllowed ? (
                          <p className="text-xs">
                            <Link
                              href="/billing"
                              className="font-medium text-brand-green underline underline-offset-2 hover:text-brand-green/80"
                            >
                              Upgrade your plan
                            </Link>{" "}
                            <span className="text-muted-foreground">
                              to add a video and stand out in search results.
                            </span>
                          </p>
                        ) : null}
                      </div>

                      {videoFile.length > 0 && (
                        <div className="space-y-3">
                          <VideoFrameSelector
                            file={videoFile[0]}
                            onFrameSelect={(frame) => {
                              setVideoCoverFile(frame ? [frame] : []);
                              clearErrors("videoThumbnail");
                              clearErrors("images");
                            }}
                          />
                          <details
                            className="group"
                            open={fieldErrors.videoThumbnail ? true : undefined}
                          >
                            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                              Or upload a custom cover image…
                            </summary>
                            <div className="mt-2">
                              <MediaUpload
                                id="listing-video-cover-input"
                                label="Custom cover image"
                                description="Optional poster image shown before the video plays."
                                maxFiles={1}
                                files={videoCoverFile}
                                error={fieldErrors.videoThumbnail}
                                onChange={(files) => {
                                  setVideoCoverFile(files);
                                  clearErrors("videoThumbnail");
                                }}
                                accept="image/*"
                              />
                              <p className="mt-2 text-xs text-muted-foreground">
                                This image is shown before the video plays and may become the hero
                                poster in previews.
                              </p>
                            </div>
                          </details>
                        </div>
                      )}
                    </PostFormSection>

                    <PostFormSection title="Brand logo" optional>
                      <div className="space-y-2">
                        <MediaUpload
                          id="listing-logo-input"
                          label="Listing logo (optional)"
                          description="Square image, shown small on listing cards."
                          maxFiles={1}
                          files={logoFile}
                          existing={
                            existingLogo
                              ? [{ url: normalizeMediaUrl(existingLogo), label: "Current logo" }]
                              : []
                          }
                          onRemoveExisting={() => setExistingLogo(null)}
                          error={fieldErrors.logo_url}
                          onChange={(files) => {
                            setLogoFile(files);
                            clearErrors("logo_url");
                          }}
                          accept="image/*"
                          recommendedAspect="Recommended: square image, at least 96 x 96."
                        />
                      </div>
                    </PostFormSection>

                    <PostFormSection title="Final check">
                      <ListingQualityHint
                        title={title}
                        description={description}
                        priceCents={price === "" ? null : Math.round(Number(price) * 100)}
                        priceExpected={category === "jobs_services" || priceMode === "amount"}
                        category={category || null}
                        location={city || null}
                        pendingPhotoCount={photoFiles.length + existingPhotos.length}
                      />

                      {copyOf !== null ? (
                        <CopyFinalCheck sameTitle={title.trim() === copyOf.trim()} />
                      ) : null}

                      {(!copyId || needsTerms) && (
                        <PostingTermsConsent
                          id="listing-terms-checkbox"
                          checked={termsAccepted}
                          onCheckedChange={(checked) => {
                            setTermsAccepted(checked);
                            clearErrors("termsAccepted");
                          }}
                          error={fieldErrors.termsAccepted}
                        />
                      )}
                    </PostFormSection>

                    {renderPreview()}
                  </div>
                )}
              </PostFormScaffold>
            </form>
          </PlanGate>
        </div>
      </main>

      <Footer />
    </div>
  );
}
